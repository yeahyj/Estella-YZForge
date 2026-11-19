import { gameTemplate, version } from '../../package.json';

/** The storage identity stays independent of the project's display name. */
export const product = {
  id: gameTemplate.id,
  build: version,
  settings: gameTemplate.settings,
  experience: gameTemplate.experience as string | null,
};
