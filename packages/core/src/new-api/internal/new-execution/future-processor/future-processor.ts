import { Future } from "../../../types/module";
import { DeploymentLoader } from "../../deployment-loader/types";
import { assertIgnitionInvariant } from "../../utils/assertions";
import { applyMessage } from "../apply-message";
import { JsonRpcClient } from "../jsonrpc-client";
import { NonceManager } from "../nonce-management";
import { TransactionTrackingTimer } from "../transaction-tracking-timer";
import { DeploymentState } from "../types/deployment-state";
import { ExecutionResultType } from "../types/execution-result";
import {
  CallExecutionState,
  DeploymentExecutionState,
  ExecutionSateType,
  ExecutionStatus,
  SendDataExecutionState,
  StaticCallExecutionState,
} from "../types/execution-state";
import { ExecutionStrategy } from "../types/execution-strategy";
import { JournalMessage, JournalMessageType } from "../types/messages";

import { buildInitializeMessageFor } from "./helpers/build-initialization-message-for";
import { monitorOnchainInteraction } from "./helpers/monitor-onchain-interaction";
import {
  NextAction,
  nextActionForExecutionState as nextActionExecutionState,
} from "./helpers/next-action-for-execution-state";
import { queryStaticCall } from "./helpers/query-static-call";
import { runStrategy } from "./helpers/run-strategy";
import { sendTransaction } from "./helpers/send-transaction";

export class FutureProcessor {
  constructor(
    private readonly _deploymentLoader: DeploymentLoader,
    private readonly _executionStrategy: ExecutionStrategy,
    private readonly _jsonRpcClient: JsonRpcClient,
    private readonly _transactionTrackingTimer: TransactionTrackingTimer,
    private readonly _nonceManager: NonceManager,
    private readonly _requiredConfirmations: number,
    private readonly _millisecondBeforeBumpingFees: number,
    private readonly _maxFeeBumps: number
  ) {}

  /**
   * Process a future, executing as much as possible, and returning the new
   * deployment state and a boolean indicating if the future was completed.
   *
   * @param future The future to process.
   * @returns An object with the new state and a boolean indicating if the future
   *  was completed. If it wasn't completed, it should be processed again later,
   *  as there's a transactions awaiting to be confirmed.
   */
  public async processFuture(
    future: Future,
    deploymentState: DeploymentState
  ): Promise<{ futureCompleted: boolean; newState: DeploymentState }> {
    let exState = deploymentState.executionStates[future.id];

    if (exState === undefined) {
      const initMessage = buildInitializeMessageFor(future);

      deploymentState = await applyMessage(
        initMessage,
        deploymentState,
        this._deploymentLoader
      );

      exState = deploymentState.executionStates[future.id];

      assertIgnitionInvariant(
        exState !== undefined,
        `Invalid initialization message for future ${future.id}: it didn't create its execution state`
      );
    }

    while (exState.status === ExecutionStatus.STARTED) {
      assertIgnitionInvariant(
        exState.type !== ExecutionSateType.CONTRACT_AT_EXECUTION_STATE &&
          exState.type !==
            ExecutionSateType.READ_EVENT_ARGUMENT_EXECUTION_STATE,
        `Unexpected ExectutionState ${exState.id} with type ${exState.type} and status ${exState.status}: it should have been immediately completed`
      );

      const nextAction = nextActionExecutionState(exState);

      const nextMessage: JournalMessage | undefined =
        await this._nextActionDispatch(exState, nextAction);

      if (nextMessage === undefined) {
        // continue with the next future
        return { futureCompleted: false, newState: deploymentState };
      }

      deploymentState = await applyMessage(
        nextMessage,
        deploymentState,
        this._deploymentLoader
      );

      await this._recordDeployedAddressIfNeeded(nextMessage);
    }

    return { futureCompleted: true, newState: deploymentState };
  }

  /**
   * Records a deployed address if the last applied message was a
   * successful completion of a deployment.
   *
   * @param lastAppliedMessage The last message that was applied to the deployment state.
   */
  private async _recordDeployedAddressIfNeeded(
    lastAppliedMessage: JournalMessage
  ) {
    if (
      lastAppliedMessage.type ===
        JournalMessageType.DEPLOYMENT_EXECUTION_STATE_COMPLETE &&
      lastAppliedMessage.result.type === ExecutionResultType.SUCCESS
    ) {
      await this._deploymentLoader.recordDeployedAddress(
        lastAppliedMessage.futureId,
        lastAppliedMessage.result.address
      );
    }
  }

  /**
   * Executes the next action for the execution state, and returns a message to
   * be applied as a result of the execution, or undefined if no progress can be made
   * yet and execution should be resumed later.
   */
  private async _nextActionDispatch(
    exState:
      | DeploymentExecutionState
      | CallExecutionState
      | SendDataExecutionState
      | StaticCallExecutionState,
    nextAction: NextAction
  ): Promise<JournalMessage | undefined> {
    switch (nextAction) {
      case NextAction.RUN_STRATEGY:
        return runStrategy(exState, this._executionStrategy);

      case NextAction.SEND_TRANSACTION:
        assertIgnitionInvariant(
          exState.type !== ExecutionSateType.STATIC_CALL_EXECUTION_STATE,
          `Unexpected transaction request in StaticCallExecutionState ${exState.id}`
        );

        return sendTransaction(
          exState,
          this._executionStrategy,
          this._jsonRpcClient,
          this._nonceManager,
          this._transactionTrackingTimer
        );

      case NextAction.QUERY_STATIC_CALL:
        return queryStaticCall(exState, this._jsonRpcClient);

      case NextAction.MONITOR_ONCHAIN_INTERACTION:
        assertIgnitionInvariant(
          exState.type !== ExecutionSateType.STATIC_CALL_EXECUTION_STATE,
          `Unexpected transaction request in StaticCallExecutionState ${exState.id}`
        );

        return monitorOnchainInteraction(
          exState,
          this._jsonRpcClient,
          this._transactionTrackingTimer,
          this._requiredConfirmations,
          this._millisecondBeforeBumpingFees,
          this._maxFeeBumps
        );
    }
  }
}
