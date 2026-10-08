import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Si algo de la interfaz falla, muestra el error y un botón para recargar en vez de una pantalla en blanco. */
export class BarreraErrores extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error en la interfaz:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-lg rounded-2xl border border-borde bg-panel p-6 shadow-suave">
          <h1 className="text-lg font-semibold">Algo ha fallado en la interfaz</h1>
          <p className="mt-1 text-sm text-texto-2">Tus apuntes están a salvo en disco. Recarga para continuar.</p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-panel-2 p-3 text-[12px] whitespace-pre-wrap text-error">{this.state.error.message}</pre>
          <div className="mt-4 flex gap-2">
            <button onClick={() => location.reload()} className="h-9 rounded-lg bg-acento px-4 text-sm font-medium text-white hover:bg-acento-2 cursor-pointer">
              Recargar
            </button>
            <button onClick={() => this.setState({ error: undefined })} className="h-9 rounded-lg border border-borde px-4 text-sm hover:bg-panel-2 cursor-pointer">
              Intentar seguir
            </button>
          </div>
        </div>
      </div>
    );
  }
}
