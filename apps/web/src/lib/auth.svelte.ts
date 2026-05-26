import { pb } from './pb';
import type { AuthModel } from 'pocketbase';

class AuthState {
  user = $state<AuthModel>(pb.authStore.model);
  token = $state<string>(pb.authStore.token);

  constructor() {
    pb.authStore.onChange(() => {
      this.user = pb.authStore.model;
      this.token = pb.authStore.token;
    }, true);
  }

  get isLoggedIn() {
    return !!this.token && !!this.user;
  }

  async signUp(email: string, password: string) {
    await pb.collection('users').create({
      email,
      password,
      passwordConfirm: password
    });
    await pb.collection('users').authWithPassword(email, password);
  }

  async logIn(email: string, password: string) {
    await pb.collection('users').authWithPassword(email, password);
  }

  logOut() {
    pb.authStore.clear();
  }
}

export const auth = new AuthState();
