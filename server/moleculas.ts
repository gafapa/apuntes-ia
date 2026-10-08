// Moléculas de los bloques ```molecula: se identifican por su nombre (en cualquier idioma que conozca
// PubChem, la base de datos pública de química) o por su SMILES. La estructura se toma de PubChem
// para que sea la real y no una que se haya inventado la IA. Las respuestas se guardan en caché.
import fs from 'node:fs/promises';
import path from 'node:path';

export interface Molecula {
  consulta: string;
  smiles: string;
  nombre?: string; // nombre común en PubChem (en inglés)
  iupac?: string;
  formula?: string;
  cid?: number;
  verificada: boolean; // false: SMILES escrito a mano que PubChem no conoce
}

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';
const PROPIEDADES = 'SMILES,IUPACName,MolecularFormula,Title';
// Algo que solo puede ser un SMILES: caracteres de SMILES y, o bien enlaces, anillos, cargas,
// corchetes o estereoquímica, o bien solo símbolos de átomos («CCO», «ClCCl»); «aspirina» no lo es
const CARACTERES_SMILES = /^[A-Za-z0-9@+\-[\]()=#$/\\%.:*]+$/;
const SOLO_ATOMOS = /^(?:Cl|Br|[BCNOPSFI]|[bcnops])+$/;
const PARECE_SMILES = { test: (q: string) => CARACTERES_SMILES.test(q) && (/[\d=#()[\]@+\-/\\]/.test(q) || SOLO_ATOMOS.test(q)) };

export class Moleculas {
  private cache?: Record<string, Molecula>;

  constructor(private archivo: string) {}

  private async leer() {
    if (!this.cache) {
      try {
        this.cache = JSON.parse(await fs.readFile(this.archivo, 'utf8'));
      } catch {
        this.cache = {};
      }
    }
    return this.cache!;
  }

  async resolver(consulta: string): Promise<Molecula> {
    const q = consulta.trim();
    if (!q) throw new Error('Falta el nombre o el SMILES de la molécula');
    const cache = await this.leer();
    const clave = q.toLowerCase();
    if (cache[clave]) return cache[clave];

    // Si parece un SMILES se busca primero como tal: como nombre, «CCO» es sinónimo de otro compuesto
    const smiles = PARECE_SMILES.test(q);
    const porSmiles = smiles ? await pedirPubChem(`${PUBCHEM}/smiles/property/${PROPIEDADES}/JSON`, q) : undefined;
    const p = smiles ? (porSmiles?.CID ? porSmiles : undefined) : await pedirPubChem(`${PUBCHEM}/name/${encodeURIComponent(q)}/property/${PROPIEDADES}/JSON`);
    let m: Molecula;
    if (p?.SMILES) {
      m = { consulta: q, smiles: p.SMILES, nombre: p.Title, iupac: p.IUPACName, formula: p.MolecularFormula, cid: p.CID, verificada: true };
    } else if (PARECE_SMILES.test(q) && !/\s/.test(q)) {
      // SMILES que PubChem no conoce (p. ej. un compuesto hipotético): se dibuja tal cual
      m = { consulta: q, smiles: q, verificada: false };
    } else {
      throw new Error(`PubChem no conoce «${q}». Prueba con el nombre en inglés o con su SMILES.`);
    }
    cache[clave] = m;
    await fs.mkdir(path.dirname(this.archivo), { recursive: true });
    await fs.writeFile(this.archivo, JSON.stringify(cache, null, 1), 'utf8').catch(() => {});
    return m;
  }
}

interface PropiedadesPubChem {
  CID?: number;
  SMILES?: string;
  IUPACName?: string;
  MolecularFormula?: string;
  Title?: string;
}

/** Primera fila de propiedades de PubChem, o undefined si no la encuentra. Lanza si no hay conexión. */
async function pedirPubChem(url: string, smiles?: string): Promise<PropiedadesPubChem | undefined> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: smiles ? 'POST' : 'GET',
      body: smiles ? new URLSearchParams({ smiles }) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('No se pudo conectar con PubChem para buscar la molécula. Comprueba la conexión a internet.');
  }
  if (r.status === 404 || r.status === 400) return undefined;
  if (!r.ok) throw new Error(`PubChem no responde (${r.status}). Inténtalo más tarde.`);
  const datos = (await r.json()) as { PropertyTable?: { Properties?: PropiedadesPubChem[] } };
  return datos.PropertyTable?.Properties?.[0];
}
