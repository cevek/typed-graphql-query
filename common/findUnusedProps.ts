import * as ts from 'typescript';
import {names} from './names';

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

export function findUnusedProps(program: ts.Program, files: ts.SourceFile[]) {
    const checker = program.getTypeChecker();
    const res: ts.Identifier[] = [];

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
                        constraint.typeName.text === names.constraintName
                    ) {
                        const nodeSourceFile = node.getSourceFile();
                        arg.properties.forEach(prop => {
                            if (!prop.name) return;
                            if (!ts.isIdentifier(prop.name)) return;
                            const refSymbols = ts.FindAllReferences.findReferencedSymbols(
                                program,
                                {isCancellationRequested: () => false, throwIfCancellationRequested() {}},
                                program.getSourceFiles(),
                                nodeSourceFile,
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
                                if (!hasUsage) {
                                    if (res.includes(prop.name)) return;
                                    res.push(prop.name);
                                }
                            }
                        });
                    }
                }
            }
        }
        ts.forEachChild(node, visitor);
    }
    files.forEach(file => {
        if (file.isDeclarationFile) return;
        visitor(file);
    });
    return res;
}
