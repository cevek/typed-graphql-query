import * as ts from 'typescript';

declare module 'typescript' {
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

const QueryType = 'Query';
const onProp = 'on';
const argsProp = '__args';

export function findUnusedProps(program: ts.Program, files: ts.SourceFile[]) {
    const checker = program.getTypeChecker();
    const unusedProps: ts.Identifier[] = [];
    const excessProps: ts.Identifier[] = [];

    function visitor(node: ts.Node) {
        if (ts.isCallExpression(node) && node.arguments) {
            if (node.arguments.length === 2) {
                const arg = node.arguments[1];
                if (ts.isObjectLiteralExpression(node.arguments[0]) && ts.isObjectLiteralExpression(arg)) {
                    const signature = checker.getResolvedSignature(node);
                    if (
                        signature &&
                        signature.declaration &&
                        ts.isFunctionLike(signature.declaration) &&
                        signature.declaration.typeParameters &&
                        signature.declaration.typeParameters.length === 1 &&
                        signature.declaration.typeParameters[0].getText() === QueryType
                    ) {
                        handleObject(arg);
                    }
                }
            }
        }
        ts.forEachChild(node, visitor);

        function handleRefs(refSymbols: ts.ReferencedSymbol[], propName: ts.Identifier, propPos: number, skipUnused: boolean) {
            // if (refSymbols.length === 1 && refSymbols[0].references.length === 1) return;
            const allRefs: ts.ReferenceEntry[] = [];
            const hasUsage = refSymbols.some(refSymbol => {
                const filteredRefs = refSymbol.references.filter(ref => {
                    if (ref.fileName.indexOf('node_modules') > -1) return false;
                    if (ref.textSpan.start === propPos) return false;
                    return true;
                });
                allRefs.push(...filteredRefs);
                return filteredRefs.some(ref => {
                    const sourceFile = program.getSourceFile(ref.fileName);
                    if (sourceFile) {
                        const token = ts.getTokenAtPosition(sourceFile, ref.textSpan.start);
                        return (
                            token &&
                            token.parent &&
                            ts.isIdentifier(token) &&
                            ts.isPropertyAccessExpression(token.parent)
                        );
                    }
                    return false;
                });
            });
            if (!hasUsage && allRefs.length > 0 && !skipUnused) {
                if (!unusedProps.includes(propName)) {
                    unusedProps.push(propName);
                }
            }
            if (allRefs.length === 0) {
                if (!excessProps.includes(propName)) {
                    excessProps.push(propName);
                }
            }
        }
        function handleObject(node: ts.Expression, skipUnused = false) {
            if (ts.isArrayLiteralExpression(node) && node.elements.length > 0) node = node.elements[0];
            if (!ts.isObjectLiteralExpression(node)) return;
            const obj = node;
            const nodeSourceFile = node.getSourceFile();
            obj.properties.forEach(prop => {
                if (!prop.name) return;
                if (!ts.isPropertyAssignment(prop)) return;
                if (!ts.isIdentifier(prop.name)) return;
                if (prop.name.text === argsProp) {
                    handleObject(prop.initializer, true);
                    return;
                }
                if (prop.name.text === onProp) {
                    if (ts.isObjectLiteralExpression(prop.initializer)) {
                        const onObj = prop.initializer;
                        onObj.properties.forEach(typeProp => {
                            if (ts.isPropertyAssignment(typeProp)) {
                                handleObject(typeProp.initializer);
                            }
                        });
                    }
                    return;
                }

                const refSymbols = ts.FindAllReferences.findReferencedSymbols(
                    program,
                    {isCancellationRequested: () => false, throwIfCancellationRequested() {}},
                    program.getSourceFiles(),
                    nodeSourceFile,
                    prop.name.getStart(),
                );
                if (refSymbols) {
                    handleRefs(refSymbols, prop.name, prop.getStart(), skipUnused);
                }
                handleObject(prop.initializer);
            });
        }
    }
    files.forEach(file => {
        if (file.isDeclarationFile) return;
        visitor(file);
    });
    return {unusedProps, excessProps};
}
