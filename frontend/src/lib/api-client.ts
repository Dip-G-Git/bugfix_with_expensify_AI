const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

class ApiClient {
  private getToken() {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('accessToken');
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) await this.handleError(res);
    const json = (await res.json()) as { data: T };
    return json.data;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.handleError(res);
    const json = (await res.json()) as { data: T };
    return json.data;
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.handleError(res);
    const json = (await res.json()) as { data: T };
    return json.data;
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 204) await this.handleError(res);
  }

  private headers(): HeadersInit {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async handleError(res: Response): Promise<never> {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) {
      localStorage.removeItem('accessToken');
      window.location.href = '/login';
    }
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export const apiClient = new ApiClient();
