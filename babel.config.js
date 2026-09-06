// Expo projects resolve `babel-preset-expo` implicitly when no babel.config.js
// exists (jest-expo and Metro both fall back to it). This file exists only to
// add one plugin on top of that same preset: `@formatjs/intl-locale` — an
// Intl polyfill Hermes needs, see src/i18n/intlPolyfills.ts — ships a static
// class initialization block, and the preset's Hermes target does not register
// the parser plugin for that syntax, so Metro (bundling for the device) and
// Jest both fail to parse it without `@babel/plugin-transform-class-static-block`.
// `babel-preset-expo` is a root devDependency so the bare specifier resolves,
// matching Expo's documented customization pattern.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@babel/plugin-transform-class-static-block'],
  };
};
