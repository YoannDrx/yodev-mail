import { GetParametersCommand } from "@aws-sdk/client-ssm";
import { awsClients } from "@/lib/aws";

const parameterSuffixes = {
  DATABASE_URL: "database-url",
  STRIPE_SECRET_KEY: "stripe-secret-key",
  WEBHOOK_SIGNING_SECRET: "webhook-signing-secret",
} as const;

type RuntimeSecretName = keyof typeof parameterSuffixes;
type RuntimeParameter = { Name?: string; Value?: string };

let loading: Promise<void> | undefined;

export function mapRuntimeParameters(
  prefix: string,
  parameters: RuntimeParameter[],
): Record<RuntimeSecretName, string> {
  const byName = new Map(
    parameters.flatMap((parameter) =>
      parameter.Name && parameter.Value
        ? [[parameter.Name, parameter.Value] as const]
        : [],
    ),
  );
  return Object.fromEntries(
    Object.entries(parameterSuffixes).map(([environmentName, suffix]) => {
      const name = `${prefix}/${suffix}`;
      const value = byName.get(name);
      if (!value) throw new Error(`Required runtime parameter is missing: ${name}`);
      return [environmentName, value];
    }),
  ) as Record<RuntimeSecretName, string>;
}

export async function loadRuntimeSecrets() {
  const prefix = process.env.RUNTIME_PARAMETER_PREFIX;
  if (!prefix) return;
  if (
    process.env.DATABASE_URL &&
    process.env.STRIPE_SECRET_KEY &&
    process.env.WEBHOOK_SIGNING_SECRET
  ) {
    return;
  }

  loading ??= (async () => {
    const names = Object.values(parameterSuffixes).map(
      (suffix) => `${prefix}/${suffix}`,
    );
    const { ssm: client } = await awsClients();
    const response = await client.send(
      new GetParametersCommand({ Names: names, WithDecryption: true }),
    );
    if (response.InvalidParameters?.length) {
      throw new Error("One or more required runtime parameters are invalid.");
    }
    Object.assign(
      process.env,
      mapRuntimeParameters(prefix, response.Parameters ?? []),
    );
  })().catch((error) => {
    loading = undefined;
    throw error;
  });

  await loading;
}

const secureParameterCache = new Map<string, string>();

export async function getSecureParameter(name: string) {
  const cached = secureParameterCache.get(name);
  if (cached) return cached;
  const { ssm: client } = await awsClients();
  const response = await client.send(
    new GetParametersCommand({ Names: [name], WithDecryption: true }),
  );
  const value = response.Parameters?.[0]?.Value;
  if (!value) throw new Error("Required provider credential is unavailable.");
  secureParameterCache.set(name, value);
  return value;
}
