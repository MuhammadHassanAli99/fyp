import crypto from 'node:crypto';
import { env } from '../../config/env';

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** STUN/TURN list for the calling client. TURN credentials stay server-minted. */
export function iceServersForUser(userId: number): IceServer[] {
  const servers: IceServer[] = [];
  if (env.STUN_URLS.length > 0) {
    servers.push({ urls: env.STUN_URLS });
  }
  if (env.TURN_URLS.length > 0) {
    if (env.TURN_SECRET) {
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const username = `${expiry}:${userId}`;
      const credential = crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
      servers.push({ urls: env.TURN_URLS, username, credential });
    } else if (env.TURN_USERNAME && env.TURN_CREDENTIAL) {
      servers.push({ urls: env.TURN_URLS, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
    }
  }
  return servers;
}
