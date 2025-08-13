// ./ssoProviders/AppleProvider.js
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const crypto = require('crypto');

class AppleProvider {
    constructor(config) {
        this.config = config;
        this.jwksClient = jwksClient({
            jwksUri: 'https://appleid.apple.com/auth/keys'
        });
    }

    async getSigningKey(kid) {
        return new Promise((resolve, reject) => {
            this.jwksClient.getSigningKey(kid, (err, key) => {
                if (err) reject(err);
                resolve(key.getPublicKey());
            });
        });
    }

    async verify(credential) {
        try {
            const decoded = jwt.decode(credential, { complete: true });
            if (!decoded || !decoded.header.kid) {
                return { status: 'error', token: '', expires_in: '', message: 'Invalid Apple token' };
            }

            const publicKey = await this.getSigningKey(decoded.header.kid);
            const payload = jwt.verify(credential, publicKey);

            if (payload.iss === 'https://appleid.apple.com' && payload.aud === this.config.appleClientId) {
                const issuedAtTime = Math.floor(Date.now() / 1000);
                const tokenExpiration = issuedAtTime + (this.config.jwtTimeToLive || 3600);

                const jwtPayload = {
                    iss: this.config.baseURL,
                    sub: payload.sub,
                    aud: this.config.baseURL,
                    iat: issuedAtTime,
                    exp: tokenExpiration,
                    email: payload.email || '',
                    given_name: payload.given_name || '',
                    family_name: payload.family_name || payload.given_name || '',
                    picture: '',
                    locale: payload.locale || 'en',
                    author: crypto.createHash('sha256').update(payload.sub).digest('hex')
                };

                const token = jwt.sign(jwtPayload, this.config.jwtSecretKey);

                return { status: 'success', token, expires_in: tokenExpiration };
            }

            return { status: 'error', token: '', expires_in: '', message: 'Invalid Apple token' };
        } catch (error) {
            console.error('Apple verification error:', error.message);
            return { status: 'error', token: '', expires_in: '', message: 'Apple verification failed' };
        }
    }
}

module.exports = AppleProvider;