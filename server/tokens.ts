// Contador de tokens consumidos por los agentes (total y del día), guardado junto a los ajustes.
import fs from 'node:fs';
import type { ContadorTokens, Motor, Tokens } from '../shared/tipos';

const cero = (): Tokens => ({ entrada: 0, salida: 0, cache: 0 });
const hoy = () => new Date().toLocaleDateString('sv'); // AAAA-MM-DD en hora local
const sumar = (a: Tokens, b: Tokens): Tokens => ({ entrada: a.entrada + b.entrada, salida: a.salida + b.salida, cache: a.cache + b.cache });

function vacio(): ContadorTokens {
  return { desde: new Date().toISOString(), total: { claude: cero(), codex: cero() }, hoy: { fecha: hoy(), porMotor: { claude: cero(), codex: cero() } } };
}

export class Contador {
  private datos: ContadorTokens;
  private temporizador?: NodeJS.Timeout;

  constructor(private archivo: string) {
    try {
      this.datos = { ...vacio(), ...JSON.parse(fs.readFileSync(archivo, 'utf8')) };
    } catch {
      this.datos = vacio();
    }
  }

  /** Estado actual (si ha cambiado el día, el contador de hoy empieza de cero). */
  leer(): ContadorTokens {
    if (this.datos.hoy.fecha !== hoy()) this.datos.hoy = { fecha: hoy(), porMotor: { claude: cero(), codex: cero() } };
    return this.datos;
  }

  sumar(motor: Motor, t: Tokens) {
    const d = this.leer();
    d.total[motor] = sumar(d.total[motor] ?? cero(), t);
    d.hoy.porMotor[motor] = sumar(d.hoy.porMotor[motor] ?? cero(), t);
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
