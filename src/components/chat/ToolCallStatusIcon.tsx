import React from 'react';
import { ActivityIndicator } from 'react-native';
import { Check, Wrench, X } from 'lucide-react-native';
import type { ToolCall } from '../../types/message';

interface ToolCallStatusIconProps {
  status: ToolCall['status'];
  color: string;
  successColor: string;
  dangerColor: string;
}

export const ToolCallStatusIcon: React.FC<ToolCallStatusIconProps> = ({
  status,
  color,
  successColor,
  dangerColor,
}) => {
  switch (status) {
    case 'completed':
      return <Check size={14} color={successColor} />;
    case 'failed':
      return <X size={14} color={dangerColor} />;
    case 'running':
      return <ActivityIndicator size="small" color={color} testID="tool-call-running-indicator" />;
    default:
      return <Wrench size={14} color={color} />;
  }
};
