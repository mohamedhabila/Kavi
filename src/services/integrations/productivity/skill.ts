import type { Skill } from '../../skills/types';
import { createApiTool } from '../shared/toolFactory';

export function createProductivitySkill(): Skill {
  return {
    id: 'productivity',
    name: 'Productivity',
    description: 'Timers, unit conversion, and calculations',
    version: '2.0.0',
    tools: [
      createApiTool(
        'timer',
        'Set a countdown timer',
        {
          seconds: { type: 'number', description: 'Duration in seconds' },
          label: { type: 'string', description: 'Timer label (optional)' },
        },
        ['seconds'],
        async (args) => {
          const seconds = Math.min(Math.max(1, args.seconds), 3600);
          return JSON.stringify({
            status: 'timer_set',
            seconds,
            label: args.label || 'Timer',
            expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
          });
        },
      ),
      createApiTool(
        'unit_convert',
        'Convert between units',
        {
          value: { type: 'number', description: 'Value to convert' },
          from: { type: 'string', description: 'Source unit (for example km, lb, or °C)' },
          to: { type: 'string', description: 'Target unit (for example mi, kg, or °F)' },
        },
        ['value', 'from', 'to'],
        async (args) => {
          const conversions: Record<string, Record<string, number | null>> = {
            km: { mi: 0.621371, m: 1000, ft: 3280.84 },
            mi: { km: 1.60934, m: 1609.34, ft: 5280 },
            kg: { lb: 2.20462, g: 1000, oz: 35.274 },
            lb: { kg: 0.453592, g: 453.592, oz: 16 },
            m: { ft: 3.28084, km: 0.001, mi: 0.000621371, cm: 100, in: 39.3701 },
            ft: { m: 0.3048, km: 0.0003048, mi: 0.000189394, cm: 30.48, in: 12 },
            '°C': { '°F': null },
            '°F': { '°C': null },
            l: { gal: 0.264172, ml: 1000 },
            gal: { l: 3.78541, ml: 3785.41 },
          };

          const from = args.from.toLowerCase().replace('celsius', '°C').replace('fahrenheit', '°F');
          const to = args.to.toLowerCase().replace('celsius', '°C').replace('fahrenheit', '°F');

          if (from === '°c' && to === '°f') {
            return JSON.stringify({
              value: args.value,
              from,
              to,
              result: (args.value * 9) / 5 + 32,
            });
          }
          if (from === '°f' && to === '°c') {
            return JSON.stringify({
              value: args.value,
              from,
              to,
              result: ((args.value - 32) * 5) / 9,
            });
          }

          const factor = conversions[from]?.[to];
          if (!factor) {
            return JSON.stringify({ error: `Unsupported conversion: ${from} → ${to}` });
          }

          return JSON.stringify({
            value: args.value,
            from: args.from,
            to: args.to,
            result: args.value * factor,
          });
        },
      ),
      createApiTool(
        'calculate',
        'Evaluate a mathematical expression',
        {
          expression: { type: 'string', description: 'Math expression (for example "2^10 + sqrt(144)")' },
        },
        ['expression'],
        async (args) => {
          try {
            const sanitized = args.expression.replace(/[^0-9+\-*/.()%^ sqrtloginabceMPIE,\s]/g, '');
            if (
              sanitized.replace(/\s/g, '').length <
              args.expression.replace(/\s/g, '').length * 0.8
            ) {
              return JSON.stringify({ error: 'Expression contains unsupported characters' });
            }
            const jsExpr = sanitized
              .replace(/\^/g, '**')
              .replace(/sqrt\(/g, 'Math.sqrt(')
              .replace(/log\(/g, 'Math.log10(')
              .replace(/ln\(/g, 'Math.log(')
              .replace(/sin\(/g, 'Math.sin(')
              .replace(/cos\(/g, 'Math.cos(')
              .replace(/abs\(/g, 'Math.abs(')
              .replace(/PI/g, 'Math.PI')
              .replace(/E(?![a-z])/g, 'Math.E');
            // The calculator intentionally evaluates a sanitized math expression
            // after allowlist filtering. It is for arithmetic only, not a general
            // JavaScript execution surface.
            const result = new Function(`"use strict"; return (${jsExpr})`)();
            if (typeof result !== 'number' || !isFinite(result)) {
              return JSON.stringify({ error: 'Expression did not produce a finite number' });
            }
            return JSON.stringify({ expression: args.expression, result });
          } catch (error: unknown) {
            return JSON.stringify({
              error: `Invalid expression: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        },
      ),
    ],
  };
}
