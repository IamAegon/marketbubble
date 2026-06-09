import { createContext, useContext } from "react";
import type { PriceTick } from "@app/shared";

const Ctx = createContext<Record<string, PriceTick>>({});
export const PricesProvider = Ctx.Provider;
export const usePrices = () => useContext(Ctx);
