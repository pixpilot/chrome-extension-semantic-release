/** A semantic-release lifecycle step, as semantic-release calls it. */
export type PluginStep = (pluginConfig: object, context: never) => unknown;

/** An inline semantic-release plugin: lifecycle step name to step. */
export type Plugin = Record<string, PluginStep>;

/**
 * Copies a plugin's lifecycle steps and names them for the log. semantic-release
 * labels every inline plugin "Inline plugin", which makes a failed step
 * impossible to attribute; it keeps a `pluginName` that is already set.
 */
export function namedPlugin(name: string, steps: object): Plugin {
  return Object.fromEntries(
    Object.entries(steps)
      .filter((entry): entry is [string, PluginStep] => typeof entry[1] === 'function')
      .map(([type, step]) => {
        const named: PluginStep = (pluginConfig, context) => step(pluginConfig, context);
        Object.defineProperty(named, 'pluginName', { value: name, enumerable: true });
        return [type, named];
      }),
  );
}
