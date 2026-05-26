import { pb } from './pb';
import { auth } from './auth.svelte';

export type Workspace = {
  id: string;
  name: string;
  owner: string;
  default_currency: string;
  billing_rounding_minutes: number;
};

class WorkspaceState {
  current = $state<Workspace | null>(null);
  loading = $state(false);

  async load() {
    if (!auth.isLoggedIn) {
      this.current = null;
      return;
    }
    this.loading = true;
    try {
      const list = await pb.collection('workspaces').getList(1, 1, {
        filter: `owner = "${auth.user?.id}"`,
        sort: 'created'
      });
      this.current = (list.items[0] as Workspace | undefined) ?? null;
    } finally {
      this.loading = false;
    }
  }
}

export const workspace = new WorkspaceState();
