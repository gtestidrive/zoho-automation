export function exportLog(product: string, stage: string, message: string): void {
  console.log(`[${new Date().toISOString()}] [${product}] [${stage}] ${message}`);
}
