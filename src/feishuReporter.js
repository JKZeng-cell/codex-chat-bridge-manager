import {
  STREAMING_CARD_ELEMENT_ID,
  buildFailureCard,
  buildFinalCard,
  buildInitialStreamingCard,
  buildMarkdownReplyChunks,
  buildStreamingCardContent
} from "./feishuCardBuilder.js";
import {
  extractReplyAttachments,
  resolveReplyAttachments,
  sendReplyAttachments as sendReplyAttachmentsViaBridge
} from "./feishuAttachments.js";
import { FlushController } from "./flushController.js";
import { cleanCodexCliNoise, describeCodexEvent, summarizeText } from "./utils.js";

function encodePostMessage(markdown) {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: "md", text: markdown }]]
    }
  });
}

function encodeInteractiveCard(card) {
  return JSON.stringify(card);
}

function extractApiCode(error) {
  return error?.response?.data?.code ?? error?.code ?? null;
}

function isRateLimitError(error) {
  return extractApiCode(error) === 230020;
}

function buildCardKitPayload(cardId) {
  return JSON.stringify({
    type: "card",
    data: {
      card_id: cardId
    }
  });
}

export function createFeishuRunReporter({ client, config, context, attachmentHelpers = {} }) {
  const parseReplyAttachments = attachmentHelpers.extractReplyAttachments || extractReplyAttachments;
  const prepareReplyAttachments = attachmentHelpers.resolveReplyAttachments || resolveReplyAttachments;
  const sendReplyAttachments = attachmentHelpers.sendReplyAttachments || sendReplyAttachmentsViaBridge;
  let reactionId = "";
  let statusText = "Queued";
  const startedAt = Date.now();
  const progressLines = [];
  const answerItems = new Map();
  let finalized = false;
  let createMessagePromise = null;
  let operationChain = Promise.resolve();

  const cardState = {
    mode: config.feishu.streamingCardEnabled ? "pending" : "patch",
    messageId: "",
    cardId: "",
    sequence: 0
  };

  const flush = new FlushController(async () => {
    await ensureCardReady();
    await performFlush();
  });

  const queueOperation = (fn) => {
    operationChain = operationChain.catch(() => {}).then(fn);
    return operationChain;
  };

  const buildReporterState = () => ({
    statusText,
    startedAt,
    progressLines,
    answerText: [...answerItems.values()].join("\n\n")
  });

  const pushLine = (line) => {
    const normalized = summarizeText(line, 200);
    if (!normalized) {
      return;
    }

    if (progressLines[progressLines.length - 1] === normalized) {
      return;
    }

    progressLines.push(normalized);
    if (progressLines.length > config.feishu.progressMaxLines) {
      progressLines.splice(0, progressLines.length - config.feishu.progressMaxLines);
    }
  };

  const setReaction = async (emojiType) => {
    if (!emojiType) {
      return;
    }

    try {
      const response = await client.im.v1.messageReaction.create({
        path: {
          message_id: context.messageId
        },
        data: {
          reaction_type: {
            emoji_type: emojiType
          }
        }
      });

      const previousReactionId = reactionId;
      reactionId = response?.data?.reaction_id || reactionId;

      if (previousReactionId && previousReactionId !== reactionId) {
        await client.im.v1.messageReaction.delete({
          path: {
            message_id: context.messageId,
            reaction_id: previousReactionId
          }
        });
      }
    } catch (error) {
      console.warn("Failed to update reaction", error);
    }
  };

  const replyInteractiveCard = async (card) => {
    return client.im.v1.message.reply({
      path: {
        message_id: context.messageId
      },
      data: {
        msg_type: "interactive",
        content: encodeInteractiveCard(card)
      }
    });
  };

  const replyCardByCardId = async (cardId) => {
    return client.im.v1.message.reply({
      path: {
        message_id: context.messageId
      },
      data: {
        msg_type: "interactive",
        content: buildCardKitPayload(cardId)
      }
    });
  };

  const patchInteractiveCard = async (card) => {
    if (!cardState.messageId) {
      return;
    }

    await client.im.v1.message.patch({
      path: {
        message_id: cardState.messageId
      },
      data: {
        content: encodeInteractiveCard(card)
      }
    });
  };

  const createCardEntity = async (card) => {
    const response = await client.cardkit.v1.card.create({
      data: {
        type: "card_json",
        data: encodeInteractiveCard(card)
      }
    });

    if (response?.code && response.code !== 0) {
      const error = new Error(`cardkit create failed: ${response.msg || response.code}`);
      error.code = response.code;
      throw error;
    }

    return response?.data?.card_id || response?.card_id || "";
  };

  const streamCardContent = async (content) => {
    cardState.sequence += 1;
    const response = await client.cardkit.v1.cardElement.content({
      path: {
        card_id: cardState.cardId,
        element_id: STREAMING_CARD_ELEMENT_ID
      },
      data: {
        content,
        sequence: cardState.sequence
      }
    });

    if (response?.code && response.code !== 0) {
      const error = new Error(`cardkit content failed: ${response.msg || response.code}`);
      error.code = response.code;
      throw error;
    }
  };

  const setCardStreamingMode = async (streamingMode) => {
    cardState.sequence += 1;
    const response = await client.cardkit.v1.card.settings({
      path: {
        card_id: cardState.cardId
      },
      data: {
        settings: JSON.stringify({
          streaming_mode: streamingMode
        }),
        sequence: cardState.sequence
      }
    });

    if (response?.code && response.code !== 0) {
      const error = new Error(`cardkit settings failed: ${response.msg || response.code}`);
      error.code = response.code;
      throw error;
    }
  };

  const updateCardKitCard = async (card) => {
    cardState.sequence += 1;
    const response = await client.cardkit.v1.card.update({
      path: {
        card_id: cardState.cardId
      },
      data: {
        card: {
          type: "card_json",
          data: encodeInteractiveCard(card)
        },
        sequence: cardState.sequence
      }
    });

    if (response?.code && response.code !== 0) {
      const error = new Error(`cardkit update failed: ${response.msg || response.code}`);
      error.code = response.code;
      throw error;
    }
  };

  const ensureCardReady = async () => {
    if (cardState.messageId) {
      return;
    }

    if (createMessagePromise) {
      await createMessagePromise;
      return;
    }

    createMessagePromise = (async () => {
      const initialCard = buildInitialStreamingCard();

      if (config.feishu.streamingCardEnabled) {
        try {
          const cardId = await createCardEntity(initialCard);
          const response = await replyCardByCardId(cardId);
          cardState.mode = "cardkit";
          cardState.cardId = cardId;
          cardState.messageId = response?.data?.message_id || "";
          cardState.sequence = 1;
          flush.setReady(Boolean(cardState.messageId));
          return;
        } catch (error) {
          console.warn("CardKit streaming setup failed, falling back to interactive patch cards", error);
        }
      }

      const response = await replyInteractiveCard(initialCard);
      cardState.mode = "patch";
      cardState.messageId = response?.data?.message_id || "";
      cardState.sequence = 0;
      flush.setReady(Boolean(cardState.messageId));
    })();

    try {
      await createMessagePromise;
    } finally {
      createMessagePromise = null;
    }
  };

  const performFlush = async () => {
    if (!cardState.messageId || finalized) {
      return;
    }

    const content = buildStreamingCardContent(buildReporterState(), {
      maxChars: config.feishu.cardContentMaxChars
    });

    if (cardState.mode === "cardkit" && cardState.cardId) {
      try {
        await streamCardContent(content);
        return;
      } catch (error) {
        if (isRateLimitError(error)) {
          return;
        }

        console.warn("CardKit streaming update failed, switching to patch mode", error);
        cardState.mode = "patch";
      }
    }

    try {
      await patchInteractiveCard({
        schema: "2.0",
        config: {
          wide_screen_mode: true,
          update_multi: true,
          summary: {
            content: statusText
          }
        },
        body: {
          elements: [
            {
              tag: "markdown",
              content
            }
          ]
        }
      });
    } catch (error) {
      if (!isRateLimitError(error)) {
        console.warn("Interactive patch update failed", error);
      }
    }
  };

  const flushSoon = () => {
    if (finalized) {
      return;
    }

    const throttleMs =
      cardState.mode === "cardkit" ? config.feishu.cardStreamUpdateMs : config.feishu.cardPatchUpdateMs;
    void flush.throttledUpdate(throttleMs);
  };

  const applyFinalCard = async (card) => {
    await ensureCardReady();

    if (cardState.mode === "cardkit" && cardState.cardId) {
      try {
        await setCardStreamingMode(false);
        await updateCardKitCard(card);
        return;
      } catch (error) {
        console.warn("CardKit finalization failed, switching to patch mode", error);
        cardState.mode = "patch";
      }
    }

    await patchInteractiveCard(card);
  };

  const replyMarkdownChunks = async (text, label) => {
    const chunks = buildMarkdownReplyChunks(text, config.feishu.maxReplyChars, label);
    for (const chunk of chunks) {
      await client.im.v1.message.reply({
        path: {
          message_id: context.messageId
        },
        data: {
          msg_type: "post",
          content: encodePostMessage(chunk)
        }
      });
    }
  };

  return {
    async acknowledge(ahead) {
      statusText = ahead > 0 ? `Queued (${ahead} ahead)` : "Received";
      pushLine(ahead > 0 ? `已进入队列，前方还有 ${ahead} 个任务` : "指令已接收，正在准备任务");

      await queueOperation(async () => {
        await setReaction(config.feishu.reactionAck);
        await ensureCardReady();
        await performFlush();
      });
    },

    start() {
      statusText = "Running";
      pushLine("已开始执行 Codex");
      flushSoon();
    },

    note(line) {
      pushLine(line);
      flushSoon();
    },

    onCodexEvent(event) {
      if (["item.started", "item.updated", "item.completed"].includes(event?.type) &&
          event.item?.type === "agent_message" && typeof event.item.text === "string") {
        answerItems.set(event.item.id || "answer", event.item.text);
      }
      const line = describeCodexEvent(event);
      if (line) {
        pushLine(line);
      }

      flushSoon();
    },

    onStderr(text) {
      void text;
    },

    async completeSuccess(result) {
      finalized = true;
      statusText = "Completed";
      pushLine("结果已准备完成");
      flush.complete();

      const rawFinalReply = cleanCodexCliNoise(result.message) || result.message || "Done.";
      const { cleanedText, attachments: rawAttachments } = parseReplyAttachments(rawFinalReply);
      const finalReply =
        cleanedText || (rawAttachments.length ? "Prepared the requested attachment output." : "Done.");
      let outboundAttachments = [];
      let attachmentNote = "";

      if (rawAttachments.length) {
        if (!config.feishu.attachmentsEnabled) {
          attachmentNote =
            "The result included attachments, but attachment sending is disabled on this Feishu bridge.";
        } else {
          try {
            outboundAttachments = prepareReplyAttachments(rawAttachments, config);
          } catch (error) {
            attachmentNote = summarizeText(
              `Attachments could not be prepared: ${error instanceof Error ? error.message : String(error)}`,
              240
            );
          }
        }
      }

      const finalCard = buildFinalCard(buildReporterState());

      await queueOperation(async () => {
        await flush.waitForFlush();
        await setReaction(config.feishu.reactionSuccess);
        await applyFinalCard(finalCard);
        await replyMarkdownChunks(finalReply, "Reply");

        if (outboundAttachments.length) {
          try {
            await sendReplyAttachments({
              messageId: context.messageId,
              attachments: outboundAttachments,
              config,
              client
            });
          } catch (error) {
            attachmentNote = summarizeText(
              `Attachments could not be sent back to Feishu: ${
                error instanceof Error ? error.message : String(error)
              }`,
              240
            );
          }
        }

        if (attachmentNote) {
          await replyMarkdownChunks(attachmentNote, "Attachment note");
        }
      });
    },

    async completeFailure(text) {
      finalized = true;
      statusText = "Failed";
      pushLine("执行过程中出现错误");
      flush.complete();

      const failureCard = buildFailureCard(buildReporterState(), text, {
        previewChars: config.feishu.cardReplyPreviewChars
      });

      await queueOperation(async () => {
        await flush.waitForFlush();
        await setReaction(config.feishu.reactionFailure);
        await applyFinalCard(failureCard);
      });
    }
  };
}
