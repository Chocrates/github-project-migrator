import fetch from 'node-fetch';
import querystring from 'querystring';
import open from 'open';
import {
  Config,
  DeviceCodeResponse,
  VerifyDeviceAuthorizationResponse,
  AccessTokenErrorResponse,
  AccessTokenResponse,
  AccessTokenErrors
} from './types';
import util from 'util';
import add from 'date-fns/add'
import compareAsc from 'date-fns/compareAsc';
import {wait, writeConfig} from './utils';

const ACCESS_TOKEN_URL_FORMAT = 'https://%s/login/oauth/access_token';
const DEVICE_CODE_URL_FORMAT = 'https://%s/login/device/code';
const CLIENT_ID = "2610da144df1af7bb253";
const OAUTH_SCOPES = "write:repo,write:org";

async function getDeviceCode(deviceCodeUrl:string): Promise<DeviceCodeResponse> {
  // https://docs.github.com/en/free-pro-team@latest/developers/apps/authorizing-oauth-apps#step-1-app-requests-the-device-and-user-verification-codes-from-github
  const now = new Date();
  const response = await fetch(deviceCodeUrl, {
    method: "POST",
    body: JSON.stringify({
      "client_id": CLIENT_ID,
      "scopes": OAUTH_SCOPES
    }),
    headers: {
      'content-type': 'application/json'
    }
  });

  /* eslint-disable @typescript-eslint/camelcase */
  const {
    device_code,
    user_code,
    verification_uri,
    expires_in,
    interval
  } = querystring.parse(await response.text());

  const deviceCodeExpirseIn = add(now, { seconds: parseInt(expires_in as string) });

  const values = {
    deviceCode: device_code as string,
    userCode: user_code as string,
    verificationUri: verification_uri as string,
    deviceCodeExpirseIn,
    deviceCodeRequestInterval: parseInt(interval as string)
  };
  console.log(`First copy your one-time code: ${values.userCode}`);
  console.log(`Press Enter to open github.com in your browser and enter your code...`);
  await open(values.verificationUri);

  return values;
  /* eslint-enable @typescript-eslint/camelcase */
}

async function verifyDeviceAuthorization(deviceCode: string, deviceCodeUrl: string, deviceCodeExpirseIn: Date, githubHost: string): Promise<VerifyDeviceAuthorizationResponse> {
  // verify if user is authenticated (poll)
  // verify if device code is still valid
  let deviceCodeResponse: DeviceCodeResponse;

  if(compareAsc(deviceCodeExpirseIn, new Date()) < 1) {
    deviceCodeResponse = await getDeviceCode(deviceCodeUrl);
    deviceCode = deviceCodeResponse.deviceCode;
  }
  const accessTokenUrl = util.format(ACCESS_TOKEN_URL_FORMAT, githubHost);
  try {
    const response = await fetch(accessTokenUrl, {
      method: 'POST',
      body: JSON.stringify({
        "client_id": CLIENT_ID,
        "device_code": deviceCode,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const responseValues = querystring.parse(await response.text());
    if( "error" in responseValues) {
      if(responseValues.error === AccessTokenErrors.AUTHORIZATION_PENDING) {
        throw new Error(responseValues.error_description as string);
      } else {
        console.error('An unforeseen error has happened!!! 💔');
        process.exit(9999);
      }
    } else {
      return {
        isAuthorized: true,
        accessToken: {
          token: responseValues.access_token as string,
          type: responseValues.token_type as string,
          scope: responseValues.scope as string
        }
      };
    }
  } catch(error) {
    console.error(error);
  }
  return {isAuthorized: false, accessToken: null };
}
export async function auth(githubHost: string): Promise<void> {
  // TODO: prompt user to select github.com or github enterprise
  const deviceCodeUrl = util.format(DEVICE_CODE_URL_FORMAT, githubHost);
  console.log('This auth does not support GitHub Enterprise Server at this moment. Support will come soon.');

  const {
    deviceCode,
    deviceCodeExpirseIn,
    deviceCodeRequestInterval
  } = await getDeviceCode(deviceCodeUrl);

  let verifyDeviceAuthorizationResponse: VerifyDeviceAuthorizationResponse;
  let isAuthorized = false;

  do {
    verifyDeviceAuthorizationResponse = await verifyDeviceAuthorization(deviceCode, deviceCodeUrl, deviceCodeExpirseIn, githubHost);
    isAuthorized = verifyDeviceAuthorizationResponse.isAuthorized;
    await wait(deviceCodeRequestInterval);

  } while(!isAuthorized);
  writeConfig(githubHost, {
    oauth_token: verifyDeviceAuthorizationResponse.accessToken?.token || '',
    user: ''
  });
}
