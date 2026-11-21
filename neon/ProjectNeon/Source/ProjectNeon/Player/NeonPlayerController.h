#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "NeonPlayerController.generated.h"

class ANeonNPC;
class ANeonVehicle;
class ANeonCharacter;
class SEditableTextBox;
class SWidget;

/** Interaction (talk, enter/exit vehicles), the typed-conversation window, save/load, time skip. */
UCLASS()
class PROJECTNEON_API ANeonPlayerController : public APlayerController
{
	GENERATED_BODY()
public:
	virtual void SetupInputComponent() override;
	virtual void PlayerTick(float DeltaTime) override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

	void Notify(const FString& Text, float Seconds = 4.f);
	TArray<TPair<FString, float>> Notifications;

	/** Context prompt shown by the HUD ("E  Talk to Lena"). */
	FString Prompt;
	bool bDebugOverlay = false;
	bool IsTalking() const { return ActiveNPC.IsValid(); }

	ANeonCharacter* GetOnFootCharacter() const { return OnFoot.Get(); }

	void OpenDialogue(ANeonNPC* NPC);
	void CloseDialogue();

private:
	TWeakObjectPtr<ANeonNPC> ActiveNPC;
	TWeakObjectPtr<ANeonCharacter> OnFoot;
	TSharedPtr<SWidget> DialogueRoot;
	TSharedPtr<SEditableTextBox> InputBox;
	FString Transcript;
	float CloseTimer = -1.f;

	void Interact();
	void EnterExit();
	void QuickSave();
	void QuickLoad();
	void TimeSkipOn();
	void TimeSkipOff();
	void ToggleDebug() { bDebugOverlay = !bDebugOverlay; }
	void SubmitLine(const FString& Text);

	ANeonNPC* FindTalkTarget() const;
	ANeonVehicle* FindVehicle() const;
};
