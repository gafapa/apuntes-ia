// Tipos mínimos de dependencias que no traen los suyos.
declare module 'algebrite' {
  const Algebrite: { run(expresion: string): string };
  export default Algebrite;
}
