import * as ts_module from 'typescript/lib/tsserverlibrary';

const maybeName = 'maybe';
const constraintName = 'GraphQLJSONConstraint';
const libName = 'typed-graphql-query';
declare module 'typescript/lib/tsserverlibrary' {
    function getTokenAtPosition(sf: ts.SourceFile, position: number): ts.Node;
    interface TypeChecker {
        isArrayLikeType(arrayType: ts.Type): arrayType is ts.TypeReference;
    }
}

function init(modules: {typescript: typeof ts_module}) {
    const ts = modules.typescript;

    function create(info: ts.server.PluginCreateInfo) {
        const proxy: ts.LanguageService = Object.create(null);
        for (let k of Object.keys(info.languageService) as Array<keyof ts.LanguageService>) {
            const x = info.languageService[k];
            proxy[k] = (...args: Array<{}>) => {
                return (x as any).apply(info.languageService, args);
            };
        }
        function typeToString(type: ts.Type, checker: ts.TypeChecker): string {
            if (type !== type.getNonNullableType())
                return maybeName + '(' + typeToString(type.getNonNullableType(), checker) + ')';
            if (type.flags & ts.TypeFlags.NumberLike) return '0';
            if (type.flags & ts.TypeFlags.StringLike) return "''";
            if (type.flags & ts.TypeFlags.BooleanLike) return 'true';
            if (checker.isArrayLikeType(type)) return `[{}]`;
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
            function getTypeDeclaration(type: ts.Type | undefined) {
                return type && getSymbolDeclaration(type.symbol);
            }
            function getSymbolDeclaration(symbol: ts.Symbol | undefined) {
                return symbol && symbol.declarations && symbol.declarations.length > 0 && symbol.declarations[0];
            }

            if (sourceFile) {
                const token = ts.getTokenAtPosition(sourceFile, position);
                const access = token.parent;
                if (access && ts.isPropertyAccessExpression(access)) {
                    result.access = access;
                    const propName = prop || access.name.text;
                    result.propName = propName;
                    const exprType = checker.getTypeAtLocation(access.expression);
                    const nonNullType = exprType && exprType.getNonNullableType();
                    const queryObject = getTypeDeclaration(nonNullType);
                    if (queryObject && ts.isObjectLiteralExpression(queryObject) && queryObject.parent) {
                        result.queryObject = queryObject;
                        const type = checker.getContextualType(
                            ts.isCallExpression(queryObject.parent) ? queryObject.parent : queryObject,
                        );
                        const nonNullType = type && type.getNonNullableType();
                        if (nonNullType && nonNullType.isUnion()) {
                            const originalInterfaceType = nonNullType.types.find(
                                t => getTypeDeclaration(t) !== queryObject,
                            );
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
            const checker = program.getTypeChecker();
            const files = program.getSourceFiles();

            function visitor(node: ts.Node) {
                if (ts.isCallExpression(node) && node.arguments && node.arguments.length === 1) {
                    const arg = node.arguments[0];
                    if (ts.isObjectLiteralExpression(arg)) {
                        const signature = checker.getResolvedSignature(node);
                        if (
                            signature &&
                            signature.declaration &&
                            ts.isFunctionDeclaration(signature.declaration) &&
                            signature.declaration.typeParameters &&
                            signature.declaration.typeParameters.length === 1
                        ) {
                            const constraint = signature.declaration.typeParameters[0].constraint;
                            if (
                                constraint &&
                                ts.isTypeReferenceNode(constraint) &&
                                ts.isIdentifier(constraint.typeName) &&
                                constraint.typeName.text === constraintName
                            ) {
                                const fileName = node.getSourceFile().fileName;
                                arg.properties.forEach(prop => {
                                    if (!prop.name) return;
                                    const refSymbols = info.languageService.findReferences(
                                        fileName,
                                        prop.name.getStart(),
                                    );
                                    if (refSymbols) {
                                        const hasUsage = refSymbols.some(refSymbol => {
                                            return refSymbol.references.some(ref => {
                                                // if (ref.isDefinition || ref.isInString) return;
                                                if (ref.textSpan.start === prop.pos) return false;
                                                const sourceFile = program.getSourceFile(ref.fileName);
                                                if (sourceFile) {
                                                    const token = ts.getTokenAtPosition(sourceFile, ref.textSpan.start);
                                                    if (
                                                        token &&
                                                        token.parent &&
                                                        ts.isIdentifier(token) &&
                                                        ts.isPropertyAccessExpression(token.parent)
                                                    ) {
                                                        return true;
                                                    }
                                                }
                                                return false;
                                            });
                                        });
                                        if (!hasUsage) {
                                            const diagnostic: ts.Diagnostic = {
                                                category: ts.DiagnosticCategory.Warning,
                                                code: 0,
                                                file: node.getSourceFile(),
                                                messageText: `Unused property "${prop.name.getText()}"`,
                                                start: prop.name.getStart(),
                                                length: prop.name.getEnd() - prop.name.getStart(),
                                            };
                                            const alreadyHasDiagnostic = res.some(
                                                diag =>
                                                    diag.messageText === diagnostic.messageText &&
                                                    diag.start === diagnostic.start &&
                                                    diag.file === diagnostic.file,
                                            );
                                            if (alreadyHasDiagnostic) return;
                                            res.push(diagnostic);
                                        }
                                    }
                                });
                            }
                        }
                    }
                }
                ts.forEachChild(node, visitor);
            }
            // files.forEach(file => {
            //     if (file.isDeclarationFile) return;
            //     visitor(file);
            // });
            const sourceFile = program.getSourceFile(fileName);
            if (sourceFile && !sourceFile.isDeclarationFile) {
                visitor(sourceFile);
            }
            return res;
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

                const insertMaybe = propType !== propType.getNonNullableType();
                const hasImportedMaybe = queryObject
                    .getSourceFile()
                    .statements.some(st =>
                        Boolean(
                            ts.isImportDeclaration(st) &&
                                ts.isStringLiteral(st.moduleSpecifier) &&
                                st.moduleSpecifier.text === libName &&
                                st.importClause &&
                                st.importClause.namedBindings &&
                                ts.isNamedImports(st.importClause.namedBindings) &&
                                st.importClause.namedBindings.elements.some(el => el.name.text === maybeName),
                        ),
                    );
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
                                        ...(insertMaybe && !hasImportedMaybe
                                            ? [
                                                  {
                                                      newText: `import {maybe} from '${libName}';\n`,
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
