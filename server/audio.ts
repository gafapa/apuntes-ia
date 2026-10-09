// Audios de los bloques ```audio (idiomas: listenings, pronunciación, dictados). Al exportar se genera
// un archivo WAV por pista con las voces instaladas en Windows (System.Speech) y en el texto queda
// «Pista N», como en los libros con audio. El profesor reparte la carpeta de audios (p. ej. en Moodle).
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { load as cargarYaml } from 'js-yaml';

/** ```audio … ``` (contenido en YAML: titulo, idioma, texto, velocidad, transcripcion). */
export const PATRON_AUDIO = /```audio[^\n]*\n([\s\S]*?)```/g;

export interface BloqueAudio {
  titulo?: string;
  idioma: string; // es, en, fr…
  texto: string;
  velocidad?: number; // -10 a 10 (0 = normal)
  transcripcion?: boolean; // mostrar el texto en los apuntes
}

export function leerAudio(contenido: string): BloqueAudio {
  const s = cargarYaml(contenido) as Partial<BloqueAudio> | undefined;
  if (!s?.texto) throw new Error('Falta «texto»');
  return { ...s, idioma: String(s.idioma ?? 'es').slice(0, 2).toLowerCase(), texto: String(s.texto) } as BloqueAudio;
}

const comillas = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Genera el WAV con una voz del idioma. Lanza un error claro si Windows no tiene esa voz. */
export async function generarWav(b: BloqueAudio, archivo: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('La generación de audio solo está disponible en Windows');
  const tmp = path.join(os.tmpdir(), `apuntes-audio-${process.pid}-${Date.now()}.txt`);
  await fs.writeFile(tmp, b.texto, 'utf8');
  const velocidad = Math.max(-10, Math.min(10, Math.round(Number(b.velocidad ?? 0))));
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like ${comillas(`${b.idioma}*`)} } | Select-Object -First 1`,
    "if (-not $v) { [Console]::Error.WriteLine('SIN_VOZ'); exit 3 }",
    '$s.SelectVoice($v.VoiceInfo.Name)',
    `$s.Rate = ${velocidad}`,
    `$s.SetOutputToWaveFile(${comillas(archivo)})`,
    `$s.Speak([IO.File]::ReadAllText(${comillas(tmp)}, [Text.Encoding]::UTF8))`,
    '$s.Dispose()',
  ].join('; ');
  try {
    await new Promise<void>((ok, mal) =>
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 120_000, windowsHide: true }, (error, _out, err) => {
        if (/SIN_VOZ/.test(String(err))) {
          mal(new Error(`Windows no tiene ninguna voz para el idioma «${b.idioma}». Instálala en Configuración › Hora e idioma › Voz.`));
        } else if (error) mal(new Error(`No se pudo generar el audio: ${String(err || error.message).trim().slice(0, 200)}`));
        else ok();
      }),
    );
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

/**
 * Sustituye cada bloque de audio por su referencia («🎧 Pista N — título») y genera los WAV en
 * `carpeta`. Si una pista no se puede generar, se deja el aviso en el texto en su lugar.
 */
export async function procesarAudios(md: string, carpeta: string, nombreCarpeta: string): Promise<string> {
  const bloques = [...md.matchAll(PATRON_AUDIO)];
  if (!bloques.length) return md;
  await fs.rm(carpeta, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(carpeta, { recursive: true });
  const sustituciones: string[] = [];
  for (let i = 0; i < bloques.length; i++) {
    const n = String(i + 1).padStart(2, '0');
    let texto: string;
    try {
      const b = leerAudio(bloques[i][1]);
      await generarWav(b, path.join(carpeta, `pista-${n}.wav`));
      texto = `> 🎧 **Pista ${i + 1}**${b.titulo ? ` — ${b.titulo}` : ''} (audio «${nombreCarpeta}/pista-${n}.wav»)`;
      if (b.transcripcion) texto += `\n>\n> *Transcripción:* ${b.texto.trim().replace(/\n+/g, ' ')}`;
    } catch (e) {
      texto = `> 🎧 **Pista ${i + 1}**: no se pudo generar el audio (${(e as Error).message})`;
    }
    sustituciones.push(texto);
  }
  let k = 0;
  return md.replace(PATRON_AUDIO, () => sustituciones[k++]);
}
