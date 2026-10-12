import { randomUUID } from 'node:crypto';
import type { BloqueActividad } from '../shared/actividades';
import { separarNotas } from './importar';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const activityLabel = /^(?:(?:actividades|ejercicios|exercicios|autoevaluacion|autoavaliacion|cuestionario|preguntas|problemas|practicas|exercises|activities|questions|problems|self-assessment)(?:\s+.*)?|(?:ejercicio|exercicio|actividad|problema|pregunta|practica|exercise|activity|problem|question)\s+\d+)(?:\s*[:.\-–].*|\s*)$/;
const solutionLabel = /^(?:soluciones|solucions|solucionario|respuestas|respostas|resolucion|solutions|answers|answer key)(?:\s+.*|\s*[:.\-–].*|\s*)$/;

function splitQuestions(body: string): { number?: string; text: string }[] {
  const questions: { number?: string; text: string }[] = [];
  let lines: string[] = [];
  let number: string | undefined;
  let fence: string | undefined;
  for (const line of body.split('\n')) {
    const marker = line.match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
    }
    const start = !fence && (line.match(/^(\d+)[.)]\s+(.+)$/) ?? line.replace(/^#{1,6}\s+/, '').replace(/\*\*|__/g, '').match(/^(?:Ejercicio|Exercicio|Actividad|Problema|Pregunta|Práctica|Exercise|Activity|Problem|Question)\s+(\d+)\s*[:.\-–]?\s*(.*)$/i));
    if (start) {
      if (number) { questions.push({ number, text: lines.join('\n').trim() }); lines = []; }
      number = start[1];
      lines.push(start[2]);
    } else lines.push(line);
  }
  if (lines.some(line => line.trim())) questions.push({ number, text: lines.join('\n').trim() });
  return questions;
}

/** Extract explicit activity blocks locally; keep worked examples and ambiguous prose in the notes. */
export function separateImportedContent(markdown: string): { notes: string; activities: BloqueActividad[] } {
  const { texto: text, notas: footnotes } = separarNotas(markdown);
  const notes: string[] = [];
  const blocks: { title: string; lines: string[]; solutions: string[]; level: number }[] = [];
  let current: typeof blocks[number] | undefined;
  let solution = false;
  let headingLevel = 0;
  let fence: string | undefined;
  for (const line of text.split('\n')) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = undefined;
      (current ? solution ? current.solutions : current.lines : notes).push(line);
      continue;
    }
    const heading = !fence ? line.match(/^(#{1,6})\s+(.+?)\s*#*$/) : null;
    const label = !fence && !/^(?: {4}|\t)/.test(line) && (heading?.[2] ?? line.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)(.*)$/)?.slice(1).join('') ?? line.match(/^((?:Ejercicio|Exercicio|Actividad|Problema|Pregunta|Práctica|Exercise|Activity|Problem|Question)\s+\d+\s*[:.\-–].*)$/i)?.[1]);
    const cleanLabel = label && normalize(label.replace(/\*\*|__/g, '').trim());
    const level = heading ? heading[1].length : headingLevel + 1;
    if (heading) headingLevel = level;
    if (cleanLabel && activityLabel.test(cleanLabel) && !/\b(resuelt[oa]s?|resolt[oa]s?|solved|worked|frecuentes)\b/.test(cleanLabel)) {
      const numbered = /^(ejercicio|exercicio|actividad|problema|pregunta|practica|exercise|activity|problem|question)\s+\d+/.test(cleanLabel);
      if (numbered && current && !solution && level >= current.level) {
        current.lines.push(line);
        continue;
      }
      current = { title: label!.replace(/\*\*|__/g, ''), lines: [], solutions: [], level };
      blocks.push(current);
      solution = false;
      // A numbered exercise label contains its prompt; retain it in the block body.
      if (numbered) current.lines.push(heading ? label! : line);
      continue;
    }
    if (cleanLabel && solutionLabel.test(cleanLabel) && blocks.length) {
      current = blocks[blocks.length - 1];
      current.level = level;
      solution = true;
      continue;
    }
    if (heading && current && level <= current.level) {
      current = undefined;
      solution = false;
    }
    (current ? solution ? current.solutions : current.lines : notes).push(line);
  }
  const usedFootnotes = new Set<string>();
  const attachFootnotes = (body: string) => {
    const references = [...body.matchAll(/\[\^([^\]\s]+)\](?!:)/g)].map(match => match[1]);
    const definitions = [...new Set(references)].filter(id => footnotes.has(id)).map(id => { usedFootnotes.add(id); return footnotes.get(id)!; });
    return `${body.trim()}${definitions.length ? `\n\n${definitions.join('\n\n')}` : ''}`;
  };
  const activities: BloqueActividad[] = blocks.filter(block => block.lines.some(line => line.trim())).map(block => {
    const body = attachFootnotes(block.lines.join('\n'));
    const solutions = attachFootnotes(block.solutions.join('\n'));
    const prompts = splitQuestions(body);
    const answers = splitQuestions(solutions);
    const now = new Date().toISOString();
    return {
      id: randomUUID().slice(0, 8), titulo: block.title, estado: 'lista', incluir: true,
      opciones: { tipos: { ejercicio: prompts.length }, dificultad: 'mixta', secciones: [], soluciones: !!solutions },
      preguntas: prompts.map(prompt => ({ tipo: 'ejercicio', enunciado: prompt.text, explicacion: prompt.number ? answers.find(answer => answer.number === prompt.number)?.text : undefined })),
      importedContent: { markdown: body, solutionsMarkdown: solutions || undefined },
      creado: now, actualizado: now,
    };
  });
  // Empty activity headings still belong to the original notes, rather than disappearing.
  for (const block of blocks.filter(block => !block.lines.some(line => line.trim()))) notes.push(`## ${block.title}`, ...block.lines, ...block.solutions);
  let theory = attachFootnotes(notes.join('\n'));
  const remaining = [...footnotes.entries()].filter(([id]) => !usedFootnotes.has(id)).map(([, definition]) => definition);
  if (remaining.length) theory += `\n\n${remaining.join('\n\n')}`;
  return { notes: theory.trim() ? `${theory.trim()}\n` : '', activities };
}
