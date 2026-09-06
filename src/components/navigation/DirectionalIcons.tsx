// ---------------------------------------------------------------------------
// Kavi — Directional (RTL-aware) Icons
// ---------------------------------------------------------------------------
// Chevron and arrow icons whose *meaning* is directional ("go back", "this
// row opens more content") rather than physical ("point at the left edge of
// the screen"). A physical `ArrowLeft`/`ChevronRight` glyph reads backwards
// once the layout direction flips for a right-to-left locale — unlike
// `alignItems`/`flexDirection: 'row'`, which Yoga mirrors automatically
// (see `resolveDirection`/`resolveCrossDirection` in
// node_modules/react-native/ReactCommon/yoga/yoga/algorithm/FlexDirection.h),
// an icon glyph is just a picture: nothing in React Native swaps which SVG
// path a `lucide-react-native` icon renders. These components pick the
// mirrored glyph explicitly from `I18nManager.isRTL`.
//
// `I18nManager.isRTL` only changes value after an app restart (RN reads the
// native constant once at bridge init — see the comment on
// `I18nManager.forceRTL` in `src/i18n/manager.ts`), so a plain read here
// (not a subscribed/reactive hook) is correct: every render already reflects
// the layout direction the rest of the screen was laid out in.

import React from 'react';
import { I18nManager } from 'react-native';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  type LucideProps,
} from 'lucide-react-native';

/**
 * A "go back / go up a level" arrow. Points toward the reading-start edge:
 * left in LTR locales, right in RTL locales.
 */
export const BackIcon: React.FC<LucideProps> = (props) =>
  I18nManager.isRTL ? <ArrowRight {...props} /> : <ArrowLeft {...props} />;

/**
 * A "go back" chevron (lighter-weight sibling of `BackIcon`, used where the
 * surrounding design already uses chevrons rather than arrows). Points
 * toward the reading-start edge.
 */
export const BackChevronIcon: React.FC<LucideProps> = (props) =>
  I18nManager.isRTL ? <ChevronRight {...props} /> : <ChevronLeft {...props} />;

/**
 * A trailing "this row opens more content" disclosure chevron. Points
 * toward the reading-end edge: right in LTR locales, left in RTL locales.
 */
export const ForwardChevronIcon: React.FC<LucideProps> = (props) =>
  I18nManager.isRTL ? <ChevronLeft {...props} /> : <ChevronRight {...props} />;

/**
 * A "proceed / continue" arrow (heavier-weight sibling of
 * `ForwardChevronIcon`, used on CTA buttons rather than list rows). Points
 * toward the reading-end edge.
 */
export const ForwardArrowIcon: React.FC<LucideProps> = (props) =>
  I18nManager.isRTL ? <ArrowLeft {...props} /> : <ArrowRight {...props} />;

/**
 * An expand/collapse disclosure chevron: points toward the reading-end
 * edge while collapsed (there is more content "ahead"), and down once
 * expanded. The down state (`ChevronDown`) is direction-agnostic and never
 * needs to flip.
 */
export const ExpandCollapseChevronIcon: React.FC<LucideProps & { expanded: boolean }> = ({
  expanded,
  ...props
}) => (expanded ? <ChevronDown {...props} /> : <ForwardChevronIcon {...props} />);
