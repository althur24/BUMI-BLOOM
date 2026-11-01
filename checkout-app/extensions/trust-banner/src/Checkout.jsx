import {
  reactExtension,
  BlockStack,
  InlineLayout,
  View,
  Text,
} from "@shopify/ui-extensions-react/checkout";

export default reactExtension("purchase.checkout.block.render", () => (
  <TrustBanner />
));

function TrustBanner() {
  return (
    <BlockStack
      background="subdued"
      border="base"
      cornerRadius="base"
      padding="base"
      spacing="tight"
    >
      <InlineLayout
        blockAlignment="center"
        columns={["auto", "fill"]}
        spacing="base"
      >
        <View>
          <Text emphasis="bold" size="large">✓</Text>
        </View>
        <BlockStack spacing="none">
          <Text emphasis="bold">Made in Indonesia · Non-toxic dyes</Text>
          <Text appearance="subdued">
            Free AU shipping over $99 · 14-day damage guarantee
          </Text>
        </BlockStack>
      </InlineLayout>
    </BlockStack>
  );
}
