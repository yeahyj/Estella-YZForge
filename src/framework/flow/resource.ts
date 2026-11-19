import { defineResource, type Plugin } from 'esengine';
import { Session } from './session';

export const GameSession = defineResource<Session>(null!, 'TemplateGameSession');
export const sessionPlugin: Plugin = {
  name: 'template-session',
  build(app) { app.insertResource(GameSession, new Session()); },
};
