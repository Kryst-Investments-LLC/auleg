import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Only show the raw error text in development — in production a generic
      // message avoids exposing internal details to end users.
      const isDev = process.env.NODE_ENV === 'development';
      const message = isDev
        ? (this.state.error?.message || 'An unexpected error occurred.')
        : 'An unexpected error occurred. Please reload the page, or try again shortly.';

      return (
        <div style={{ padding: 40, textAlign: 'center', maxWidth: 500, margin: '80px auto' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ marginBottom: 12 }}>Something went wrong</h2>
          <p style={{ color: '#888', marginBottom: 24 }}>{message}</p>
          <button
            className="btn-primary"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
