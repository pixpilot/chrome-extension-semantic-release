// The semantic-release plugins ship JavaScript without type declarations. They
// are only ever spread into inline plugin objects, so a loose step signature is
// enough.
type PluginStep = (pluginConfig: object, context: object) => Promise<unknown> | unknown;

declare module '@semantic-release/commit-analyzer' {
  export const analyzeCommits: PluginStep;
}

declare module '@semantic-release/release-notes-generator' {
  export const generateNotes: PluginStep;
}

declare module '@semantic-release/changelog' {
  export const verifyConditions: PluginStep;
  export const prepare: PluginStep;
}

declare module '@semantic-release/git' {
  export const verifyConditions: PluginStep;
  export const prepare: PluginStep;
}

declare module '@semantic-release/github' {
  export const verifyConditions: PluginStep;
  export const publish: PluginStep;
  export const addChannel: PluginStep;
  export const success: PluginStep;
  export const fail: PluginStep;
}

declare module 'conventional-changelog-conventionalcommits' {
  interface ConventionalCommitsPreset {
    parser: Record<string, unknown>;
    writer: Record<string, unknown>;
  }

  export default function createPreset(
    config?: Record<string, unknown>,
  ): ConventionalCommitsPreset;
}
