import { useQueryProvider as embedded } from "../QueryProviderEmbedded";
import { useQueryProvider as worker } from "../QueryProvider";

export const useDbQuery = embedded;
