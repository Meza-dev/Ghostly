export class LlmError extends Error {
  status: number;
  providerId: string;

  constructor(message: string, status: number, providerId: string) {
    super(message);
    this.name = "LlmError";
    this.status = status;
    this.providerId = providerId;
  }
}
