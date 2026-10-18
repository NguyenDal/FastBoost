import { Component } from 'react';
import '../styles/PageLoadBoundary.css';

export default class PageLoadBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className={`page-load-message${this.props.compact ? ' page-load-message--compact' : ''}`}>
          <h2>This page could not be loaded</h2>
          <p>Check your connection, then reload to try again.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload page</button>
        </div>
      );
    }
    return this.props.children;
  }
}
