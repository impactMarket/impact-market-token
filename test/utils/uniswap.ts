import * as ethersTypes from "ethers";
import { BigNumber } from "ethers";
import bn from "bignumber.js";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { fromEther, toEther } from "./helpers";
const NFTPositionManagerABI =
	require("../../util/abi/uniswap/periphery/NonfungiblePositionManager.json").abi;

const SwapRouterABI =
	require("../../util/abi/uniswap/periphery/SwapRouter.json").abi;
const QuoterABI = require("../../util/abi/uniswap/periphery/Quoter.json").abi;

export const uniswapRouterAddress =
	"0xb24372480f6bcc574591eF26EE18dDBdf93cbc2d";
export const uniswapQuoterAddress =
	"0xb24372480f6bcc574591eF26EE18dDBdf93cbc2d";
export const uniswapNFTPositionManagerAddress =
	"0x52bc21329aDb4305d68B0d5265406AC5ABb25a02";


// export const uniswapRouterAddress =
// 	"0x5615CDAb10dc425a742d643d949a7F474C01abc4";
// export const uniswapQuoterAddress =
// 	"0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8";
// export const uniswapNFTPositionManagerAddress =
// 	"0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A";
// export const uniswapExchangePathCUSDToPACT =
// 	"0x765de816845861e75a25fca122bb6898b8b1282a00271046c9757c5497c5b1f2eb73ae79b6b67d119b0b58";

export async function createPool(
	creator: SignerWithAddress,
	token0: ethersTypes.Contract,
	token1: ethersTypes.Contract,
	amount0: BigNumber,
	amount1: BigNumber,
	ownerAddress?: string | null
): Promise<number> {
	const NFTPositionManager = await ethers.getContractAt(
		NFTPositionManagerABI,
		uniswapNFTPositionManagerAddress
	);

	await token0.connect(creator).approve(NFTPositionManager.address, amount0);
	await token1.connect(creator).approve(NFTPositionManager.address, amount1);

	if (token0.address.toLowerCase() > token1.address.toLowerCase()) {
		const token0Copy = token0;
		token0 = token1;
		token1 = token0Copy;

		const amount0Copy = amount0;
		amount0 = amount1;
		amount1 = amount0Copy;
	}

	await NFTPositionManager.connect(
		creator
	).createAndInitializePoolIfNecessary(
		token0.address,
		token1.address,
		10000,
		encodePriceSqrt(amount0, amount1),
		// '2505290050365003892876723467', //encodePriceSqrt(BigNumber.from(1), BigNumber.from(1000)),   //price
		{ gasLimit: 5000000 }
	);

	await NFTPositionManager.connect(creator).mint({
		token0: token0.address,
		token1: token1.address,
		fee: 10000,
		tickLower: -887200,
		tickUpper: 887200,
		amount0Desired: amount0,
		amount1Desired: amount1,
		amount0Min: 0, //don't let it 0 into production
		amount1Min: 0, //don't let it 0 into production
		recipient: creator.address, // ownerAddress ? ownerAddress : creator.address,
		deadline: 1773341392,
	});

	const tokenId = await NFTPositionManager.tokenByIndex(
		(await NFTPositionManager.totalSupply()) - 1
	);

	if (ownerAddress) {
		// await NFTPositionManager.connect(creator).approve();
		await NFTPositionManager.connect(creator).transferFrom(
			creator.address,
			ownerAddress,
			tokenId
		);
	}

	// console.log('**********************************************************')

	// // await NFTPositionManager.connect(creator).approve()
	//
	// // if (ownerAddress) {
	// // 	await NFTPositionManager.connect(creator).transferFrom(creator.address, ownerAddress, tokenId);
	// // }
	//
	// console.log(creator.address)
	// console.log(ownerAddress)
	// console.log(ownerAddress ? ownerAddress : creator.address)
	// // console.log('ownerOf: ', await NFTPositionManager.ownerOf(2536));
	// console.log('ownerOf: ', await NFTPositionManager.ownerOf(tokenId));

	return tokenId;
}

export function getExchangePath(
	token0: ethersTypes.Contract,
	token1: ethersTypes.Contract,
	token2?: ethersTypes.Contract
) {
	if (token2) {
		return ethers.utils.solidityPack(
			["address", "uint24", "address", "uint24", "address"],
			[token0.address, 10000, token1.address, 10000, token2.address]
		);
	} else {
		return ethers.utils.solidityPack(
			["address", "uint24", "address"],
			[token0.address, 10000, token1.address]
		);
	}
}

export function getExchangePath2(
	token0: string,
	token1: string,
) {

		return ethers.utils.solidityPack(
			["address", "uint24", "address"],
			[token0, 10000, token1]);
}

export function getExchangePathProd(
	token0Address: string,
	token1Address: string
) {
	return ethers.utils.solidityPack(
		["address", "uint24", "address"],
		[token0Address, 10000, token1Address]
	);
}

// returns the sqrt price as a 64x96
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });
function encodePriceSqrt(reserve0: BigNumber, reserve1: BigNumber): BigNumber {
	return BigNumber.from(
		new bn(reserve1.toString())
			.div(reserve0.toString())
			.sqrt()
			.multipliedBy(new bn(2).pow(96))
			.integerValue(3)
			.toString()
	);
}

export async function increaseLiquidity(
	owner: SignerWithAddress,
	nftId: number,
	token0: ethersTypes.Contract,
	token1: ethersTypes.Contract,
	amount0: BigNumber,
	amount1: BigNumber
): Promise<any> {
	const NFTPositionManager = await ethers.getContractAt(
		NFTPositionManagerABI,
		uniswapNFTPositionManagerAddress
	);

	// console.log(fromEther(await token0.balanceOf(owner.address)));
	// console.log(fromEther(await token1.balanceOf(owner.address)));

	await token0
		.connect(owner)
		.approve(NFTPositionManager.address, toEther("1000000000000000"));
	await token1
		.connect(owner)
		.approve(NFTPositionManager.address, toEther("1000000000000000"));
	// await token0.connect(owner).approve('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x633987602DE5C4F337e3DbF265303A1080324204', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x633987602DE5C4F337e3DbF265303A1080324204', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0xc1b262Dd7643D4B7cA9e51631bBd900a564BF49A', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0xc1b262Dd7643D4B7cA9e51631bBd900a564BF49A', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x5f115D9113F88e0a0Db1b5033D90D4a9690AcD3D', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x5f115D9113F88e0a0Db1b5033D90D4a9690AcD3D', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x5615CDAb10dc425a742d643d949a7F474C01abc4', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x5615CDAb10dc425a742d643d949a7F474C01abc4', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0xa9Fd765d85938D278cb0b108DbE4BF7186831186', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0xa9Fd765d85938D278cb0b108DbE4BF7186831186', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x644023b316bB65175C347DE903B60a756F6dd554', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x644023b316bB65175C347DE903B60a756F6dd554', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x505B43c452AA4443e0a6B84bb37771494633Fde9', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x505B43c452AA4443e0a6B84bb37771494633Fde9', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x3cFd4d48EDfDCC53D3f173F596f621064614C582', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x3cFd4d48EDfDCC53D3f173F596f621064614C582', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x5615CDAb10dc425a742d643d949a7F474C01abc4', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x5615CDAb10dc425a742d643d949a7F474C01abc4', toEther('1000000000000000'));
	// await token0.connect(owner).approve('0x000000000022d473030f116ddee9f6b43ac78ba3', toEther('1000000000000000'));
	// await token1.connect(owner).approve('0x000000000022d473030f116ddee9f6b43ac78ba3', toEther('1000000000000000'));

	if (token0.address > token1.address) {
		const token0Copy = token0;
		token0 = token1;
		token1 = token0Copy;

		const amount0Copy = amount0;
		amount0 = amount1;
		amount1 = amount0Copy;
	}

	// console.log(fromEther(await token0.allowance(owner.address, NFTPositionManager.address)));
	// console.log(fromEther(await token1.allowance(owner.address, NFTPositionManager.address)));

	return await NFTPositionManager.connect(owner).increaseLiquidity({
		tokenId: nftId,
		amount0Desired: amount0,
		amount1Desired: amount1,
		amount0Min: 0,
		amount1Min: 0,
		deadline: 1773341392,
	});
}

export async function swap(
	owner: SignerWithAddress,
	token0: ethersTypes.Contract,
	token1: ethersTypes.Contract,
	amount: BigNumber
) {
	const SwapRouter = await ethers.getContractAt(
		SwapRouterABI,
		uniswapRouterAddress
	);

	await token0
		.connect(owner)
		.approve(SwapRouter.address, toEther("10000000000"));

	await token1
		.connect(owner)
		.approve(SwapRouter.address, toEther("10000000000"));

	await SwapRouter.connect(owner).exactInput({
		path: getExchangePath(token0, token1),
		recipient: owner.address,
		amountIn: amount,
		amountOutMinimum: 0,
	});
}

export async function getExactInput(
	token0: ethersTypes.Contract,
	token1: ethersTypes.Contract,
	amount: BigNumber
): Promise<BigNumber> {
	const Quoter = await ethers.getContractAt(QuoterABI, uniswapQuoterAddress);

	return (
		await Quoter.callStatic.quoteExactInput(
			getExchangePath(token0, token1),
			amount
		)
	).amountOut;
}

export async function getExactOutput(
	token0: ethersTypes.Contract,
	token1: ethersTypes.Contract,
	amount: BigNumber
): Promise<BigNumber> {
	const Quoter = await ethers.getContractAt(QuoterABI, uniswapQuoterAddress);

	return (
		await Quoter.callStatic.quoteExactOutput(
			getExchangePath(token0, token1),
			amount
		)
	).amountIn;
}

export async function position(tokenId: number) {
	const NFTPositionManager = await ethers.getContractAt(
		NFTPositionManagerABI,
		uniswapNFTPositionManagerAddress
	);

	console.log(await NFTPositionManager.positions(tokenId));
}
