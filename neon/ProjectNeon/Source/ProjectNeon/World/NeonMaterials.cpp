#include "World/NeonMaterials.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Materials/Material.h"
#include "UObject/Package.h"
#if WITH_EDITOR
#include "Materials/MaterialExpressionVectorParameter.h"
#include "Materials/MaterialExpressionScalarParameter.h"
#include "Materials/MaterialExpressionMultiply.h"
#endif

namespace
{
	UMaterialInterface* Fallback()
	{
		return LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	}

#if WITH_EDITOR
	UMaterial* Build(bool bGlow)
	{
		UMaterial* M = NewObject<UMaterial>(GetTransientPackage(), bGlow ? TEXT("NeonGlow") : TEXT("NeonSurface"), RF_Transient);
		UMaterialEditorOnlyData* Ed = M->GetEditorOnlyData();
		auto* Col = NewObject<UMaterialExpressionVectorParameter>(M);
		Col->ParameterName = TEXT("Color"); Col->DefaultValue = FLinearColor(0.5f, 0.5f, 0.5f);
		auto* Rough = NewObject<UMaterialExpressionScalarParameter>(M);
		Rough->ParameterName = TEXT("Roughness"); Rough->DefaultValue = 0.7f;
		auto* Metal = NewObject<UMaterialExpressionScalarParameter>(M);
		Metal->ParameterName = TEXT("Metallic"); Metal->DefaultValue = 0.f;
		M->GetExpressionCollection().AddExpression(Col);
		M->GetExpressionCollection().AddExpression(Rough);
		M->GetExpressionCollection().AddExpression(Metal);
		Ed->BaseColor.Connect(0, Col);
		Ed->Roughness.Connect(0, Rough);
		Ed->Metallic.Connect(0, Metal);
		if (bGlow)
		{
			auto* Glow = NewObject<UMaterialExpressionScalarParameter>(M);
			Glow->ParameterName = TEXT("Glow"); Glow->DefaultValue = 0.f;
			auto* Mul = NewObject<UMaterialExpressionMultiply>(M);
			Mul->A.Connect(0, Col); Mul->B.Connect(0, Glow);
			M->GetExpressionCollection().AddExpression(Glow);
			M->GetExpressionCollection().AddExpression(Mul);
			Ed->EmissiveColor.Connect(0, Mul);
		}
		M->PostEditChange();
		M->AddToRoot();
		return M;
	}
#endif

	UMaterialInterface* Get(bool bGlow)
	{
		static UMaterialInterface* Cache[2] = { nullptr, nullptr };
		UMaterialInterface*& C = Cache[bGlow ? 1 : 0];
		if (!C)
		{
#if WITH_EDITOR
			C = Build(bGlow);
#endif
			if (!C) C = Fallback();
		}
		return C;
	}
}

UMaterialInterface* NeonMaterials::BaseSurface() { return Get(false); }
UMaterialInterface* NeonMaterials::BaseGlow() { return Get(true); }

UMaterialInstanceDynamic* NeonMaterials::Surface(UObject* Outer, const FLinearColor& Color, float Roughness, float Metallic)
{
	UMaterialInstanceDynamic* MID = UMaterialInstanceDynamic::Create(BaseSurface(), Outer);
	MID->SetVectorParameterValue(TEXT("Color"), Color);
	MID->SetScalarParameterValue(TEXT("Roughness"), Roughness);
	MID->SetScalarParameterValue(TEXT("Metallic"), Metallic);
	return MID;
}

UMaterialInstanceDynamic* NeonMaterials::Glow(UObject* Outer, const FLinearColor& Color, float Intensity)
{
	UMaterialInstanceDynamic* MID = UMaterialInstanceDynamic::Create(BaseGlow(), Outer);
	MID->SetVectorParameterValue(TEXT("Color"), Color);
	MID->SetScalarParameterValue(TEXT("Glow"), Intensity);
	return MID;
}
