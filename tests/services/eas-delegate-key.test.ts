import test from "node:test";
import assert from "node:assert/strict";
import {
  getThirdwebManagedWallet,
  loadEasDelegatePrivateKey
} from "@/lib/services/eas-delegate-key";

const VALID_KEY = `0x${"1".repeat(64)}`;

function withEnv(
  values: Record<string, string | undefined>,
  run: () => void
) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("delegate key loader accepts a 0x-prefixed environment key", () => {
  withEnv({ EAS_DELEGATE_PRIVATE_KEY: VALID_KEY }, () => {
    assert.equal(loadEasDelegatePrivateKey(), VALID_KEY);
  });
});

test("delegate key loader normalizes an unprefixed environment key", () => {
  withEnv({ EAS_DELEGATE_PRIVATE_KEY: "1".repeat(64) }, () => {
    assert.equal(loadEasDelegatePrivateKey(), VALID_KEY);
  });
});

test("delegate key loader tolerates surrounding whitespace", () => {
  withEnv({ EAS_DELEGATE_PRIVATE_KEY: `  ${VALID_KEY}\n` }, () => {
    assert.equal(loadEasDelegatePrivateKey(), VALID_KEY);
  });
});

test("delegate key loader refuses a key of the wrong length", () => {
  withEnv({ EAS_DELEGATE_PRIVATE_KEY: `0x${"1".repeat(60)}` }, () => {
    assert.throws(() => loadEasDelegatePrivateKey(), /Invalid EAS_DELEGATE_PRIVATE_KEY format/);
  });
});

test("delegate key loader refuses a key containing non-hex characters", () => {
  withEnv({ EAS_DELEGATE_PRIVATE_KEY: `0x${"z".repeat(64)}` }, () => {
    assert.throws(() => loadEasDelegatePrivateKey(), /Invalid EAS_DELEGATE_PRIVATE_KEY format/);
  });
});

test("delegate key loader never falls back silently when the env key is malformed", () => {
  withEnv({ EAS_DELEGATE_PRIVATE_KEY: "0xnope" }, () => {
    assert.throws(() => loadEasDelegatePrivateKey());
  });
});

test("thirdweb managed wallet is only reported when both credentials are present", () => {
  withEnv(
    {
      THIRDWEB_SECRET_KEY: "secret",
      THIRDWEB_SERVER_WALLET_ADDRESS: `0x${"3".repeat(40)}`
    },
    () => {
      assert.deepEqual(getThirdwebManagedWallet(), {
        secretKey: "secret",
        walletAddress: `0x${"3".repeat(40)}`
      });
    }
  );
});

test("thirdweb managed wallet is ignored when the secret key is missing", () => {
  withEnv(
    {
      THIRDWEB_SECRET_KEY: undefined,
      THIRDWEB_SERVER_WALLET_ADDRESS: `0x${"3".repeat(40)}`
    },
    () => {
      assert.equal(getThirdwebManagedWallet(), null);
    }
  );
});

test("thirdweb managed wallet is ignored when the address is missing", () => {
  withEnv(
    {
      THIRDWEB_SECRET_KEY: "secret",
      THIRDWEB_SERVER_WALLET_ADDRESS: undefined
    },
    () => {
      assert.equal(getThirdwebManagedWallet(), null);
    }
  );
});

test("thirdweb managed wallet is ignored when the address is not hex-prefixed", () => {
  withEnv(
    {
      THIRDWEB_SECRET_KEY: "secret",
      THIRDWEB_SERVER_WALLET_ADDRESS: "not-an-address"
    },
    () => {
      assert.equal(getThirdwebManagedWallet(), null);
    }
  );
});
