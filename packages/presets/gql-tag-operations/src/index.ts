import * as addPlugin from '@graphql-codegen/add';
import type { Types } from '@graphql-codegen/plugin-helpers';
import * as typedDocumentNodePlugin from '@graphql-codegen/typed-document-node';
import * as typescriptOperationPlugin from '@graphql-codegen/typescript-operations';
import * as typescriptPlugin from '@graphql-codegen/typescript';

import * as gqlTagPlugin from '@graphql-codegen/gql-tag-operations';
import { processSources } from './process-sources.js';
import { ClientSideBaseVisitor } from '@graphql-codegen/visitor-plugin-common';
import babelPlugin from './babel.js';
import * as fragmentMaskingPlugin from './fragment-masking-plugin.js';

export type FragmentMaskingConfig = {
  /**
   * @description The module name from which a augmented module should be imported from.
   */
  augmentedModuleName?: string;
  /** @description Name of the function that should be used for unmasking a masked fragment property.
   * @default `'useFragment'`
   */
  unmaskFunctionName?: string;
};

export type GqlTagConfig = {
  /**
   * @description Instead of generating a `gql` function, this preset can also generate a `d.ts` that will enhance the `gql` function of your framework.
   *
   * E.g. `graphql-tag` or `@urql/core`.
   *
   * @exampleMarkdown
   * ```yaml {5}
   * generates:
   *   gql/:
   *     preset: gql-tag-operations-preset
   *     presetConfig:
   *       augmentedModuleName: '@urql/core'
   * ```
   */
  augmentedModuleName?: string;
  /**
   * @description Fragment masking hides data from components and only allows accessing the data by using a unmasking function.
   * @exampleMarkdown
   * ```yaml
   * generates:
   *   gql/:
   *     preset: gql-tag-operations-preset
   *     presetConfig:
   *       fragmentMasking: true
   * ```
   *
   * When using the `augmentedModuleName` option, the unmask function will by default NOT be imported from the same module. It will still be generated to a `index.ts` file. You can, however, specify to resolve the unmasking function from an an augmented module by using the `augmentedModuleName` object sub-config.
   * @exampleMarkdown
   * ```yaml {6-7}
   * generates:
   *   gql/:
   *     preset: gql-tag-operations-preset
   *     presetConfig:
   *       augmentedModuleName: '@urql/core'
   *       fragmentMasking:
   *         augmentedModuleName: '@urql/fragment'
   * ```
   */
  fragmentMasking?: FragmentMaskingConfig | boolean;
  /**
   * @description If base schema types are in another file,
   * you can specify this as the relative path to it.
   *
   * @exampleMarkdown
   * ```yaml {5}
   * generates:
   *   path/to/file.ts:
   *     preset: gql-tag-operations-preset
   *     presetConfig:
   *       importTypesPath: types.ts
   * ```
   */
  importTypesPath: string;
  /**
   * @description Optional, override the name of the import namespace used to import from the `baseTypesPath` file.
   * @default Types
   *
   * @exampleMarkdown
   * ```yaml {6}
   * generates:
   *   src/:
   *     preset: gql-tag-operations-preset
   *     presetConfig:
   *       importTypesPath: types.ts
   *       importTypesNamespace: SchemaTypes
   * ```
   */
  importTypesNamespace?: string;
  /**
   * @description Specify the name of the "graphql tag" function to use
   * @default "gql"
   *
   * E.g. `graphql` or `gql`.
   *
   * @exampleMarkdown
   * ```yaml {5}
   * generates:
   *   gql/:
   *     preset: gql-tag-operations-preset
   *     presetConfig:
   *       gqlTagName: 'graphql'
   * ```
   */
  gqlTagName?: string;
};

export const preset: Types.OutputPreset<GqlTagConfig> = {
  buildGeneratesSection: options => {
    // TODO: add link?
    // eslint-disable-next-line no-console
    console.warn('DEPRECATED: `gql-tag-operations-preset` is deprecated in favor of `client-preset`.');
    /** when not using augmentation stuff must be re-exported. */
    const reexports: Array<string> = [];

    const visitor = new ClientSideBaseVisitor(options.schemaAst!, [], options.config, options.config);
    let fragmentMaskingConfig: FragmentMaskingConfig | null = null;

    if (typeof options?.presetConfig?.fragmentMasking === 'object') {
      fragmentMaskingConfig = options.presetConfig.fragmentMasking;
    } else if (options?.presetConfig?.fragmentMasking === true) {
      fragmentMaskingConfig = {};
    }

    const isMaskingFragments = fragmentMaskingConfig != null;

    const sourcesWithOperations = processSources(options.documents, node => {
      if (node.kind === 'FragmentDefinition') {
        return visitor.getFragmentVariableName(node);
      }
      return visitor.getOperationVariableName(node);
    });
    const sources = sourcesWithOperations.map(({ source }) => source);

    const pluginMap = {
      ...options.pluginMap,
      [`add`]: addPlugin,
      [`typescript`]: typescriptPlugin,
      [`typescript-operations`]: typescriptOperationPlugin,
      [`typed-document-node`]: typedDocumentNodePlugin,
      [`gen-dts`]: gqlTagPlugin,
    };

    const plugins: Array<Types.ConfiguredPlugin> = [{ [`add`]: { content: `/* eslint-disable */` } }];
    if (!options.presetConfig.importTypesPath) {
      plugins.push({ [`typescript`]: {} });
    }
    plugins.push({ [`typescript-operations`]: {} }, { [`typed-document-node`]: {} }, ...options.plugins);

    const genDtsPlugins: Array<Types.ConfiguredPlugin> = [
      { [`add`]: { content: `/* eslint-disable */` } },
      { [`gen-dts`]: { sourcesWithOperations } },
    ];

    let gqlArtifactFileExtension = '.d.ts';
    if (options.presetConfig.augmentedModuleName == null) {
      gqlArtifactFileExtension = '.ts';
      reexports.push('gql');
    }

    const config: Record<string, any> = {
      ...options.config,
      inlineFragmentTypes: isMaskingFragments ? 'mask' : options.config['inlineFragmentTypes'],
    };

    if (options.presetConfig.importTypesPath) {
      const importType = options.config.useTypeImports ? 'import type' : 'import';
      const importTypesNamespace = options.presetConfig.importTypesNamespace || 'Types';
      plugins[0].add.content += `\n${importType} * as ${importTypesNamespace} from '${options.presetConfig.importTypesPath}';`;
      config.namespacedImportName = importTypesNamespace;
    }

    let fragmentMaskingFileGenerateConfig: Types.GenerateOptions | null = null;

    if (isMaskingFragments === true) {
      let fragmentMaskingArtifactFileExtension = '.d.ts';

      if (fragmentMaskingConfig.augmentedModuleName == null) {
        reexports.push('fragment-masking');
        fragmentMaskingArtifactFileExtension = '.ts';
      }

      fragmentMaskingFileGenerateConfig = {
        filename: `${options.baseOutputDir}/fragment-masking${fragmentMaskingArtifactFileExtension}`,
        pluginMap: {
          [`fragment-masking`]: fragmentMaskingPlugin,
        },
        plugins: [
          {
            [`fragment-masking`]: {},
          },
        ],
        schema: options.schema,
        config: {
          useTypeImports: options.config.useTypeImports,
          augmentedModuleName: fragmentMaskingConfig.augmentedModuleName,
          unmaskFunctionName: fragmentMaskingConfig.unmaskFunctionName,
        },
        documents: [],
      };
    }

    let indexFileGenerateConfig: Types.GenerateOptions | null = null;

    const reexportsExtension = options.config.emitLegacyCommonJSImports ? '' : '.js';

    if (reexports.length) {
      indexFileGenerateConfig = {
        filename: `${options.baseOutputDir}/index.ts`,
        pluginMap: {
          [`add`]: addPlugin,
        },
        plugins: [
          {
            [`add`]: {
              content: reexports.map(moduleName => `export * from "./${moduleName}${reexportsExtension}"`).join('\n'),
            },
          },
        ],
        schema: options.schema,
        config: {},
        documents: [],
      };
    }

    return [
      {
        filename: `${options.baseOutputDir}/graphql.ts`,
        plugins,
        pluginMap,
        schema: options.schema,
        config,
        documents: sources,
      },
      {
        filename: `${options.baseOutputDir}/gql${gqlArtifactFileExtension}`,
        plugins: genDtsPlugins,
        pluginMap,
        schema: options.schema,
        config: {
          ...config,
          augmentedModuleName: options.presetConfig.augmentedModuleName,
          gqlTagName: options.presetConfig.gqlTagName || 'gql',
        },
        documents: sources,
      },
      ...(fragmentMaskingFileGenerateConfig ? [fragmentMaskingFileGenerateConfig] : []),
      ...(indexFileGenerateConfig ? [indexFileGenerateConfig] : []),
    ];
  },
};

export { babelPlugin };
