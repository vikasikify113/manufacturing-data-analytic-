import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught error in ErrorBoundary:', error, info);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-6">
          <div className="w-full max-w-lg rounded-lg border border-[#FECACA] bg-white p-6">
            <div className="flex items-center gap-2.5 text-[#DC2626]">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <h1 className="text-base font-semibold text-[#0F172A]">
                Workspace Data Error
              </h1>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#475569] break-words">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[#0284C7] px-4 py-2 text-xs font-medium text-white hover:bg-[#0369A1]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
