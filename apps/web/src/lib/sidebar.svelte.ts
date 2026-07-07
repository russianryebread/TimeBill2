/** Shared sidebar drawer state for mobile. */
class SidebarState {
  open = $state(false);
  toggle() { this.open = !this.open; }
  close() { this.open = false; }
}

export const sidebar = new SidebarState();
