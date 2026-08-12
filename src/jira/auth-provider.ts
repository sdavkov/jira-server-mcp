export interface AuthProvider {
  apply(headers: Headers): void;
}

export class BasicAuthProvider implements AuthProvider {
  private readonly authorization: string;

  public constructor(username: string, password: string) {
    const encoded = Buffer.from(`${username}:${password}`, "utf8").toString(
      "base64",
    );
    this.authorization = `Basic ${encoded}`;
  }

  public apply(headers: Headers): void {
    headers.set("authorization", this.authorization);
  }
}
