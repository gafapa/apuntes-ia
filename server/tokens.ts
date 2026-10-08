// Contador de tokens consumidos por los agentes (total y del día), guardado junto a los ajustes.
import fs from 'node:fs';
import type { ContadorTokens, GastoAsignatura, Motor, Tokens, Trabajo } from '../shared/tipos';

const cero = (): Tokens => ({ entrada: 0, salida: 0, cache: 0 });
const hoy = () => new Date().toLocaleDateString('sv'); // AAAA-MM-DD en hora local
const sumar = (a: Tokens, b: Tokens): Tokens => ({ entrada: a.entrada + b.entrada, salida: a.salida + b.salida, cache: a.cache + b.cache });

function vacio(): ContadorTokens {
  return { desde: new Date().toISOString(), total: { claude: cero(), codex: cero() }, hoy: { fecha: hoy(), porMotor: { claude: cero(), codex: cero() } }, porAsignatura: {} };
}

export class Contador {
  private datos: ContadorTokens;
  private temporizador?: NodeJS.Timeout;

  constructor(private archivo: string) {
    try {
      const leido = JSON.parse(fs.readFileSync(archivo, 'utf8'));
      this.datos = { ...vacio(), ...leido };
      if (!leido.porAsignatura) delete this.datos.porAsignatura; // contador antiguo: se siembra con los trabajos
    } catch {
      this.datos = vacio();
    }
  }

  /** Estado actual (si ha cambiado el día, el contador de hoy empieza de cero). */
  leer(): ContadorTokens {
    if (this.datos.hoy.fecha !== hoy()) this.datos.hoy = { fecha: hoy(), porMotor: { claude: cero(), codex: cero() } };
    return this.datos;
  }

  sumar(motor: Motor, t: Tokens, asignatura?: string, documento?: string) {
    const d = this.leer();
    d.total[motor] = sumar(d.total[motor] ?? cero(), t);
    d.hoy.porMotor[motor] = sumar(d.hoy.porMotor[motor] ?? cero(), t);
    if (asignatura) this.sumarA(motor, t, asignatura, documento);
    this.guardar();
  }

  private sumarA(motor: Motor, t: Tokens, asignatura: string, documento?: string) {
    const por = (this.datos.porAsignatura ??= {});
    const a: GastoAsignatura = (por[asignatura] ??= { total: { claude: cero(), codex: cero() }, documentos: {} });
    a.total[motor] = sumar(a.total[motor] ?? cero(), t);
    if (documento) {
      const doc = (a.documentos[documento] ??= { claude: cero(), codex: cero() });
      doc[motor] = sumar(doc[motor] ?? cero(), t);
    }
  }

  /**
   * La primera vez (contadores de antes de existir el desglose), reparte por asignatura y documento
   * lo que consta en los trabajos que todavía se conservan.
   */
  sembrar(trabajos: Trabajo[]) {
    if (this.datos.porAsignatura) return;
    this.datos.porAsignatura = {};
    for (const t of trabajos) if (t.tokens && t.asignatura) this.sumarA(t.motor, t.tokens, t.asignatura, t.documento);
    this.guardar();
  }

  reiniciar() {
    this.datos = vacio();
    this.guardar();
  }

  private guardar() {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => fs.writeFile(this.archivo, JSON.stringify(this.datos), () => {}), 500);
  }
}
