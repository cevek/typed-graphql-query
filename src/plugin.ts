import * as tsServer from 'typescript/lib/tsserverlibrary';
import * as ts from 'typescript';
import {names} from '../common/names';
import {findUnusedProps} from '../common/findUnusedProps';

declare module 'typescript/lib/tsserverlibrary' {
    function getTokenAtPosition(sf: ts.SourceFile, position: number): ts.Node;
    interface TypeChecker {
        isArrayLikeType(arrayType: ts.Type): arrayType is ts.TypeReference;
    }
    namespace FindAllReferences {
        export function findReferencedSymbols(
            program: ts.Program,
            cancellationToken: ts.CancellationToken,
            sourceFiles: ReadonlyArray<ts.SourceFile>,
            sourceFile: ts.SourceFile,
            position: number,
        ): ts.ReferencedSymbol[] | undefined;
    }
}

function getTypeDeclaration(type: ts.Type | undefined) {
    return (type && getSymbolDeclaration(type.symbol || type.aliasSymbol)) || undefined;
}
function getSymbolDeclaration(symbol: ts.Symbol | undefined) {
    return (symbol && symbol.declarations && symbol.declarations.length > 0 && symbol.declarations[0]) || undefined;
}

function init(modules: {}) {
    // const ts = modules.typescript;

    function create(info: tsServer.server.PluginCreateInfo) {
        const proxy: ts.LanguageService = Object.create(null);
        for (let k of Object.keys(info.languageService) as Array<keyof ts.LanguageService>) {
            const x = info.languageService[k];
            proxy[k] = (...args: Array<{}>) => {
                return (x as any).apply(info.languageService, args);
            };
        }
        const usedImports = {maybe: false, union: false};
        function typeToString(type: ts.Type | undefined, checker: ts.TypeChecker, insertTypename = false): string {
            if (!type) return '{}';
            if (type !== type.getNonNullableType()) {
                usedImports.maybe = true;
                return names.maybeName + '(' + typeToString(type.getNonNullableType(), checker) + ')';
            }
            if (type.isUnion()) {
                usedImports.union = true;
                return (
                    names.unionName +
                    `({} as ${checker.typeToString(type)}, ${type.types
                        .map(t => typeToString(t, checker, true))
                        .join(', ')})`
                );
            }
            if (type.flags & ts.TypeFlags.NumberLike) return '0';
            if (type.flags & ts.TypeFlags.StringLike) return "''";
            if (type.flags & ts.TypeFlags.BooleanLike) return 'true';
            if (checker.isArrayLikeType(type))
                return `[${typeToString(type.typeArguments && type.typeArguments[0], checker)}]`;
            if (insertTypename) {
                const typenameNode = getSymbolDeclaration(type.getProperty('__typename'));
                const typenameType = typenameNode && checker.getTypeAtLocation(typenameNode);
                if (typenameType && typenameType.isStringLiteral()) return `{__typename: "${typenameType.value}"}`;
            }
            return '{}';
        }
        function getInfo(fileName: string, position: number, prop?: string) {
            const program = info.project.getLanguageService().getProgram()!;
            const checker = program.getTypeChecker();
            const sourceFile = program.getSourceFile(fileName);
            const result: {
                propName?: string;
                propType?: ts.Type;
                checker: ts.TypeChecker;
                sourceFile?: ts.SourceFile;
                originalInterfaceType?: ts.Type;
                access?: ts.PropertyAccessExpression;
                queryObject?: ts.ObjectLiteralExpression;
            } = {
                sourceFile,
                checker,
                access: undefined,
                originalInterfaceType: undefined,
                queryObject: undefined,
                propName: undefined,
                propType: undefined,
            };

            if (sourceFile) {
                const token = ts.getTokenAtPosition(sourceFile, position);
                const access = token.parent;
                if (access && ts.isPropertyAccessExpression(access)) {
                    result.access = access;
                    const propName = prop || access.name.text;
                    result.propName = propName;
                    const exprNonNullType = checker.getTypeAtLocation(access.expression).getNonNullableType();
                    const queryObject = getTypeDeclaration(exprNonNullType);
                    if (queryObject && ts.isObjectLiteralExpression(queryObject) && queryObject.parent) {
                        let typenameValue = '';
                        for (let i = 0; i < queryObject.properties.length; i++) {
                            const prop = queryObject.properties[i];
                            if (
                                ts.isPropertyAssignment(prop) &&
                                ts.isIdentifier(prop.name) &&
                                prop.name.text === '__typename' &&
                                ts.isStringLiteral(prop.initializer)
                            ) {
                                typenameValue = prop.initializer.text;
                                break;
                            }
                        }
                        result.queryObject = queryObject;
                        const type =
                            checker.getContextualType(queryObject) ||
                            checker.getContextualType(
                                ts.isCallExpression(queryObject.parent) &&
                                    ts.isObjectLiteralExpression(queryObject.parent.parent)
                                    ? queryObject.parent
                                    : queryObject,
                            );
                        const nonNullType = type && type.getNonNullableType();
                        if (nonNullType && nonNullType.isUnion()) {
                            const originalInterfaceType = nonNullType.types.find(t => {
                                if (typenameValue === '') {
                                    return getTypeDeclaration(t) !== queryObject;
                                }
                                const typenameNode = getSymbolDeclaration(t.getProperty('__typename'));
                                const typenameType = typenameNode && checker.getTypeAtLocation(typenameNode);
                                return Boolean(
                                    typenameType &&
                                        typenameType.isStringLiteral() &&
                                        typenameType.value === typenameValue,
                                );
                            });
                            result.originalInterfaceType = originalInterfaceType;
                            if (originalInterfaceType) {
                                const identDeclaration = getSymbolDeclaration(
                                    originalInterfaceType
                                        .getProperties()
                                        .find(symbol => symbol.escapedName === propName),
                                );
                                if (identDeclaration) {
                                    result.propType = checker.getTypeAtLocation(identDeclaration);
                                }
                            }
                        }
                    }
                }
            }
            return result;
        }

        proxy.getSemanticDiagnostics = fileName => {
            const res = info.languageService.getSemanticDiagnostics(fileName);
            const program = info.project.getLanguageService().getProgram()!;
            const unusedIdents = findUnusedProps(program, [program.getSourceFile(fileName)!]);
            return [
                ...res,
                ...unusedIdents.map<ts.Diagnostic>(ident => ({
                    category: ts.DiagnosticCategory.Warning,
                    code: 0,
                    file: ident.getSourceFile(),
                    messageText: `Unused property "${ident.getText()}"`,
                    start: ident.getStart(),
                    length: ident.getEnd() - ident.getStart(),
                })),
            ];
        };

        proxy.getCompletionEntryDetails = (fileName, position, name, formatOptions, source, preferences) => {
            const res = info.languageService.getCompletionEntryDetails(
                fileName,
                position,
                name,
                formatOptions,
                source,
                preferences,
            );
            const {propName, propType, queryObject, checker} = getInfo(fileName, position - 1, name);
            if (propName && queryObject && propType) {
                const hasOtherProps = queryObject.properties.length > 0;
                const start = hasOtherProps
                    ? queryObject.properties[queryObject.properties.length - 1].end
                    : queryObject.getStart() + 1;

                const propExists = queryObject.properties.some(
                    prop => !!(prop.name && ts.isIdentifier(prop.name) && prop.name.text === propName),
                );
                if (propExists) return res;

                const hasImportedMaybe = hasImport(queryObject.getSourceFile(), names.libName, names.maybeName);
                const hasImportedUnion = hasImport(queryObject.getSourceFile(), names.libName, names.unionName);
                return {
                    name: propName,
                    kind: ts.ScriptElementKind.interfaceElement,
                    kindModifiers: '',
                    displayParts: [{kind: 'text', text: 'Auto insert to graphql query definition'}],

                    codeActions: [
                        {
                            fixName: 'Add field to graphql query',
                            description: 'Add field to graphql query',
                            changes: [
                                {
                                    fileName: queryObject.getSourceFile().fileName,
                                    textChanges: [
                                        ...(usedImports.maybe && !hasImportedMaybe
                                            ? [
                                                  {
                                                      newText: `import {maybe} from '${names.libName}';\n`,
                                                      span: {
                                                          start: 0,
                                                          length: 0,
                                                      },
                                                  },
                                              ]
                                            : []),
                                        ...(usedImports.union && !hasImportedUnion
                                            ? [
                                                  {
                                                      newText: `import {union} from '${names.libName}';\n`,
                                                      span: {
                                                          start: 0,
                                                          length: 0,
                                                      },
                                                  },
                                              ]
                                            : []),
                                        {
                                            newText:
                                                (hasOtherProps ? ', ' : '') +
                                                propName +
                                                ': ' +
                                                typeToString(propType, checker),
                                            span: {
                                                start,
                                                length: 0,
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                };
            }
            return res;
        };
        proxy.getCompletionsAtPosition = (fileName, position, options) => {
            let res = info.languageService.getCompletionsAtPosition(fileName, position, options);
            const {originalInterfaceType} = getInfo(fileName, position - 1);
            if (originalInterfaceType) {
                if (!res)
                    res = {
                        isGlobalCompletion: false,
                        isMemberCompletion: true,
                        isNewIdentifierLocation: false,
                        entries: [],
                    };
                res.entries = [
                    ...res.entries,
                    ...originalInterfaceType
                        .getProperties()
                        .filter(symbol => res!.entries.every(entry => entry.name !== symbol.name))
                        .map<ts.CompletionEntry>(symbol => ({
                            name: symbol.name,
                            insertText: symbol.name,
                            kind: ts.ScriptElementKind.interfaceElement,
                            sortText: '0',
                            hasAction: true,
                        })),
                ];
            }
            return res;
        };
        return proxy;
    }
    return {create};
}

export = init;

function hasImport(sourceFile: ts.SourceFile, module: string, element: string) {
    return sourceFile.statements.some(st =>
        Boolean(
            ts.isImportDeclaration(st) &&
                ts.isStringLiteral(st.moduleSpecifier) &&
                st.moduleSpecifier.text === module &&
                st.importClause &&
                st.importClause.namedBindings &&
                ts.isNamedImports(st.importClause.namedBindings) &&
                st.importClause.namedBindings.elements.some(el => el.name.text === element),
        ),
    );
}
