import React from 'react';
import { AlertTriangle } from 'lucide-react-native';
import i18n from '../i18n';
import { StateView } from './StateView';

interface State {
  failed: boolean;
}

/** Catches a crash inside a screen so the farmer sees a calm message and a retry, not a white screen. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onError?: (error: Error) => void },
  State
> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    if (__DEV__) console.error('[ErrorBoundary]', error);
    this.props.onError?.(error);
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <StateView
        kind="error"
        icon={AlertTriangle}
        title={i18n.t('boundary.title')}
        message={i18n.t('boundary.message')}
        actionLabel={i18n.t('common.retry')}
        onAction={() => this.setState({ failed: false })}
      />
    );
  }
}
