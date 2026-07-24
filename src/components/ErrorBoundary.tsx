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
      const title = this.props.fallbackTitle || i18n.t('errorBoundary.title');
      const message = this.props.fallbackMessage || i18n.t('errorBoundary.message');
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.icon}>
              ⚠️
            </Text>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text accessibilityLiveRegion="assertive" style={styles.message}>
              {message}
            </Text>
            <TouchableOpacity
              accessibilityLabel={i18n.t('common.retry')}
              accessibilityRole="button"
              style={styles.retryBtn}
              onPress={this.handleRetry}
              testID="error-boundary-retry"
            >
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
    flexGrow: 1,
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
  retryBtn: {
    minHeight: 48,
    justifyContent: 'center',
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
