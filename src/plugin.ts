import * as tsServer from 'typescript/lib/tsserverlibrary';
import * as ts from 'typescript';
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
        function getTypename(type: ts.Type, checker: ts.TypeChecker) {
            const symbol = type.getProperty('__typename');
            const node = getSymbolDeclaration(symbol);
            if (symbol && node) {
                const t = checker.getTypeOfSymbolAtLocation(symbol, node);
                return t.isStringLiteral() ? t.value : undefined;
            }
            return undefined;
        }
        function typeToString(type: ts.Type | undefined, checker: ts.TypeChecker): string {
            if (!type) return '{}';
            if (type !== type.getNonNullableType()) {
                return typeToString(type.getNonNullableType(), checker);
            }
            if (type.isUnion()) {
                return `{on: {${type.types
                    .filter(t => Boolean(getTypename(t, checker)))
                    .map(t => getTypename(t, checker) + ': ' + typeToString(t, checker))
                    .join(', ')}}}`;
            }
            if (type.flags & ts.TypeFlags.NumberLike) return '0';
            if (type.flags & ts.TypeFlags.StringLike) return "''";
            if (type.flags & ts.TypeFlags.BooleanLike) return 'true';
            if (checker.isArrayLikeType(type))
                return `[${typeToString(type.typeArguments && type.typeArguments[0], checker)}]`;
            const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
            if (signatures.length > 0) {
                const signature = signatures[0];
                return typeToString(signature.getReturnType(), checker);
            }

            return '{}';
        }
        function getInfo(fileName: string, position: number, prop?: string) {
            const program = info.project.getLanguageService().getProgram()!;
            const checker = program.getTypeChecker();
            const sourceFile = program.getSourceFile(fileName);
            const result: {
                propName?: string;
                propSymbol?: ts.Symbol;
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

            function getOriginalType(type: ts.Type) {
                if (type.isIntersection()) type = type.types[0];
                if (type.aliasSymbol && type.aliasSymbol.escapedName === 'Result' && type.aliasTypeArguments) {
                    let subType = type.aliasTypeArguments[0];
                    if (subType.isIntersection()) subType = subType.types[0];
                    if (
                        subType &&
                        subType.aliasSymbol &&
                        subType.aliasSymbol.escapedName === 'TransformEntity' &&
                        subType.aliasTypeArguments
                    ) {
                        return subType.aliasTypeArguments[0];
                    }
                }
            }
            function getDeclaredType(type: ts.Type) {
                if (type.isIntersection()) type = type.types[0];
                if (
                    type.aliasSymbol &&
                    type.aliasSymbol.escapedName === 'Result' &&
                    type.aliasTypeArguments &&
                    type.aliasTypeArguments.length === 1
                ) {
                    return type.aliasTypeArguments[0];
                }
            }

            if (sourceFile) {
                const token = ts.getTokenAtPosition(sourceFile, position);
                const access = token.parent;
                if (access && ts.isPropertyAccessExpression(access)) {
                    result.access = access;
                    const propName = prop || access.name.text;
                    result.propName = propName;
                    let accessExprType = checker.getTypeAtLocation(access.expression);
                    if (accessExprType.isIntersection()) {
                        accessExprType = accessExprType.types[0];
                    }

                    let originalType;
                    let declaredType;
                    if (accessExprType.isUnion() && accessExprType.types.length === 2) {
                        originalType = getOriginalType(accessExprType.types[0]);
                        declaredType = getDeclaredType(accessExprType.types[1]);
                    }
                    if (!accessExprType.isUnion()) {
                        declaredType = getDeclaredType(accessExprType);
                        const queryObject = getTypeDeclaration(declaredType);
                        if (queryObject && ts.isObjectLiteralExpression(queryObject)) {
                            const ctxType = checker.getContextualType(queryObject);
                            if (ctxType && ctxType.isUnion() && ctxType.types.length === 2) {
                                originalType = ctxType.types[0];
                            }
                        }
                    }

                    if (declaredType && originalType) {
                        const queryObject = getTypeDeclaration(declaredType);
                        if (queryObject && ts.isObjectLiteralExpression(queryObject) && queryObject.parent) {
                            result.queryObject = queryObject;
                            result.originalInterfaceType = originalType;
                            const identDeclaration = getSymbolDeclaration(
                                originalType.getProperties().find(symbol => symbol.escapedName === propName),
                            );
                            if (identDeclaration) {
                                result.propType = checker.getTypeAtLocation(identDeclaration);
                                result.propSymbol = originalType.getProperty(propName);
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
            const {unusedProps, excessProps} = findUnusedProps(program, [program.getSourceFile(fileName)!]);
            return [
                ...res,
                ...unusedProps.map<ts.Diagnostic>(ident => ({
                    category: ts.DiagnosticCategory.Warning,
                    code: 0,
                    file: ident.getSourceFile(),
                    messageText: `Unused property "${ident.getText()}"`,
                    start: ident.getStart(),
                    length: ident.getEnd() - ident.getStart(),
                })),
                ...excessProps.map<ts.Diagnostic>(ident => ({
                    category: ts.DiagnosticCategory.Error,
                    code: 0,
                    file: ident.getSourceFile(),
                    messageText: `Property "${ident.getText()}" doesn't exist`,
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
            const {propName, propSymbol, propType, queryObject, checker} = getInfo(fileName, position - 1, name);
            function getDocumentation(symbol: ts.Symbol | undefined) {
                if (symbol) {
                    const doc = symbol.getDocumentationComment(checker).pop();
                    if (doc) return doc.text;
                }
            }
            if (propName && queryObject && propType) {
                const hasOtherProps = queryObject.properties.length > 0;
                const start = hasOtherProps
                    ? queryObject.properties[queryObject.properties.length - 1].end
                    : queryObject.getStart() + 1;

                const propExists = queryObject.properties.some(
                    prop => !!(prop.name && ts.isIdentifier(prop.name) && prop.name.text === propName),
                );
                if (propExists) return res;

                const doc = getDocumentation(propSymbol);
                return {
                    name: propName,
                    kind: ts.ScriptElementKind.interfaceElement,
                    kindModifiers: '',
                    displayParts: [
                        {
                            kind: 'text',
                            text: `Auto insert to graphql query definition\n(property) ${propName}: ${checker.typeToString(
                                propType,
                            )}${doc ? `\n\n${doc}` : ''}`,
                        },
                    ],

                    codeActions: [
                        {
                            fixName: 'Add field to graphql query',
                            description: 'Add field to graphql query',
                            changes: [
                                {
                                    fileName: queryObject.getSourceFile().fileName,
                                    textChanges: [
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
