// Governor run-loop halt gate (#2347). Consults non-convergence + budget caps at each iteration boundary,
// releases in-flight portfolio items on a fresh halt, and records the decision to the governor ledger.
import { buildRunLoopHaltGovernorLedgerEvent, evaluateRunLoopHalt } from "@loopover/engine";
import { appendGovernorEvent } from "./governor-ledger.js";
/**
 * Evaluate run-loop halt signals before claiming the next portfolio item.
 */
export function evaluateRunLoopBoundaryGate(input, options = {}) {
    const append = options.append ?? appendGovernorEvent;
    const wasHalted = Boolean(input.runHalted);
    const verdict = evaluateRunLoopHalt({
        runHalted: wasHalted,
        usage: input.usage,
        limits: input.limits,
        convergence: input.convergence,
        ...(input.convergenceThresholds !== undefined ? { convergenceThresholds: input.convergenceThresholds } : {}),
    });
    const newlyHalted = !wasHalted && verdict.shouldHalt;
    let releasedItem = null;
    if (newlyHalted && input.inFlightItem && typeof input.markFailed === "function") {
        releasedItem = input.markFailed(input.inFlightItem.repoFullName, input.inFlightItem.identifier);
    }
    const recorded = newlyHalted || (!wasHalted && !verdict.shouldHalt)
        ? append(buildRunLoopHaltGovernorLedgerEvent(input.inFlightItem?.repoFullName ?? null, input.inFlightItem?.identifier ?? null, verdict))
        : null;
    return {
        verdict,
        recorded,
        runHalted: verdict.shouldHalt,
        canClaimNext: verdict.canClaimNext,
        releasedItem,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ292ZXJub3ItcnVuLWhhbHQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJnb3Zlcm5vci1ydW4taGFsdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSwwR0FBMEc7QUFDMUcsdUdBQXVHO0FBRXZHLE9BQU8sRUFBRSxtQ0FBbUMsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLGtCQUFrQixDQUFDO0FBUTVGLE9BQU8sRUFBRSxtQkFBbUIsRUFBRSxNQUFNLHNCQUFzQixDQUFDO0FBMkIzRDs7R0FFRztBQUNILE1BQU0sVUFBVSwyQkFBMkIsQ0FDekMsS0FBdUMsRUFDdkMsVUFBaUYsRUFBRTtJQUVuRixNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxJQUFJLG1CQUFtQixDQUFDO0lBQ3JELE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDM0MsTUFBTSxPQUFPLEdBQUcsbUJBQW1CLENBQUM7UUFDbEMsU0FBUyxFQUFFLFNBQVM7UUFDcEIsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO1FBQ2xCLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTtRQUNwQixXQUFXLEVBQUUsS0FBSyxDQUFDLFdBQVc7UUFDOUIsR0FBRyxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUUscUJBQXFCLEVBQUUsS0FBSyxDQUFDLHFCQUFxQixFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztLQUM3RyxDQUFDLENBQUM7SUFFSCxNQUFNLFdBQVcsR0FBRyxDQUFDLFNBQVMsSUFBSSxPQUFPLENBQUMsVUFBVSxDQUFDO0lBQ3JELElBQUksWUFBWSxHQUFzQixJQUFJLENBQUM7SUFDM0MsSUFBSSxXQUFXLElBQUksS0FBSyxDQUFDLFlBQVksSUFBSSxPQUFPLEtBQUssQ0FBQyxVQUFVLEtBQUssVUFBVSxFQUFFLENBQUM7UUFDaEYsWUFBWSxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxZQUFZLEVBQUUsS0FBSyxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUNsRyxDQUFDO0lBRUQsTUFBTSxRQUFRLEdBQ1osV0FBVyxJQUFJLENBQUMsQ0FBQyxTQUFTLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDO1FBQ2hELENBQUMsQ0FBQyxNQUFNLENBQ0osbUNBQW1DLENBQ2pDLEtBQUssQ0FBQyxZQUFZLEVBQUUsWUFBWSxJQUFJLElBQUksRUFDeEMsS0FBSyxDQUFDLFlBQVksRUFBRSxVQUFVLElBQUksSUFBSSxFQUN0QyxPQUFPLENBQ29CLENBQzlCO1FBQ0gsQ0FBQyxDQUFDLElBQUksQ0FBQztJQUVYLE9BQU87UUFDTCxPQUFPO1FBQ1AsUUFBUTtRQUNSLFNBQVMsRUFBRSxPQUFPLENBQUMsVUFBVTtRQUM3QixZQUFZLEVBQUUsT0FBTyxDQUFDLFlBQVk7UUFDbEMsWUFBWTtLQUNiLENBQUM7QUFDSixDQUFDIn0=