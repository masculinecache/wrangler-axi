export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", (err: Error) => reject(err));
  });
}

export function isStdinTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}
