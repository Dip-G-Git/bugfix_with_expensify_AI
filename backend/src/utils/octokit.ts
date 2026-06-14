import { Octokit } from '@octokit/rest';

export function createOctokit(token: string) {
  return new Octokit({ auth: token });
}
