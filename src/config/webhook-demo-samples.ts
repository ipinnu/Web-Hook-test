import panicFixture from '../../scripts/fixtures/mix-webhook-panic.json';
import tripFixture from '../../scripts/fixtures/mix-webhook-trip.json';
import positionFixture from '../../scripts/fixtures/mix-webhook-position.json';

export type WebhookSampleKey = 'panic' | 'trip' | 'position' | 'vehicle' | 'driver';

export const bundledWebhookSamples: Record<WebhookSampleKey, unknown> = {
  panic: panicFixture,
  trip: tripFixture,
  position: positionFixture,
  vehicle: {
    AssetId: '1234567890123456789',
    RegistrationNumber: 'DEMO-JMG-001',
    Description: 'DEMO - JMG sample vehicle',
    Make: 'Demo',
    Model: 'Webhook',
  },
  driver: {
    DriverId: '1234567890123456790',
    Name: 'DEMO Driver',
    MobileNumber: '+2340000000000',
  },
};
