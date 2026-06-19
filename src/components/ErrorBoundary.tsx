import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { i18n } from '../i18n/manager';

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.warn('[ErrorBoundary]', error.message, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.icon}>⚠️</Text>
            <Text style={styles.title}>
              {this.props.fallbackTitle || i18n.t('errorBoundary.title')}
            </Text>
            <Text style={styles.message}>
              {this.props.fallbackMessage || i18n.t('errorBoundary.message')}
            </Text>
            {this.state.error ? <Text style={styles.error}>{this.state.error.message}</Text> : null}
            <TouchableOpacity style={styles.retryBtn} onPress={this.handleRetry}>
              <Text style={styles.retryText}>{i18n.t('common.retry')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#999',
    marginBottom: 12,
    textAlign: 'center',
    lineHeight: 20,
  },
  error: {
    fontSize: 12,
    color: '#f66',
    marginBottom: 16,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#333',
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
