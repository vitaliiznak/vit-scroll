import React from "react";

// Keep the controls and comparison results alive after a render/lifecycle error.
// Renderer crashes and synchronous freezes need the external benchmark runner.
export class PreviewBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    this.props.onError?.(error);
  }
  render() {
    if (this.state.error)
      return <div className="preview-error" role="alert">
        <strong>This library could not render the table.</strong>
        <span>{this.state.error.message}</span>
        <span>Choose another library or reduce the number of rows.</span>
      </div>;
    return this.props.children;
  }
}
