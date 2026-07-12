import {
  ChannelSendResult,
  MessagingChannelDriver,
  MessagingRecipient,
  OutboundMessage,
} from '../messaging.types';

export abstract class BaseMessagingChannel implements MessagingChannelDriver {
  abstract readonly channel: MessagingChannelDriver['channel'];
  abstract isEnabled(): boolean;
  abstract send(
    recipient: MessagingRecipient,
    message: OutboundMessage,
  ): Promise<ChannelSendResult>;
}
