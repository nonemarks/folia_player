// src/components/shared/ErrorBoundary.tsx
// React Error Boundary that catches rendering errors in child components,
// preventing the entire component tree from unmounting on error.

import React from 'react';

interface ErrorBoundaryProps {
    children: React.ReactNode;
    /** Optional fallback UI to render on error. Defaults to a compact error message. */
    fallback?: React.ReactNode;
    /** Optional callback when an error is caught, for logging/diagnostics. */
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('[ErrorBoundary] Caught rendering error:', error);
        console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
        this.props.onError?.(error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }
            // Default fallback: visible error message with retry button
            // Uses inline styles to avoid depending on Tailwind classes that might fail
            return (
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '24px',
                        textAlign: 'center',
                        minHeight: '120px',
                    }}
                >
                    <div style={{
                        color: '#f87171',
                        fontSize: '13px',
                        marginBottom: '12px',
                        maxWidth: '400px',
                        wordBreak: 'break-word',
                        lineHeight: 1.5,
                    }}>
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </div>
                    <button
                        type="button"
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{
                            fontSize: '12px',
                            padding: '6px 16px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.05)',
                            color: 'var(--text-primary, #fff)',
                            cursor: 'pointer',
                            transition: 'background 0.2s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    >
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}